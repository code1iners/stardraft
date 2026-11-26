import { copyFile, lstat, mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_INFO } from '../../shared/agent-info';
import type { DiagnosisReport, DiagnosisReproduction, ReproductionImpossibleReason, SentryDiagnosis } from './sentry-diagnosis';

/** 내보낸 보고서 하나. */
export interface ExportedDiagnosisReport {
  /** 만든 마크다운 파일의 절대 경로. */
  path: string;
  /** 파일 이름(확장자 포함). 토스트에 보인다. */
  fileName: string;
}

/** 내보내기에 필요한 것. */
export interface ExportDiagnosisOptions {
  /** 내보낼 진단. 검토 대기 보고서가 있어야 한다. */
  diagnosis: SentryDiagnosis;
  /** 보고서를 만들 폴더. 없으면 만든다. */
  folder: string;
  /** 첨부 파일 이름. 이 이름의 파일을 `attachmentsDir`에서 보고서와 같은 이름의 폴더로 복사한다. */
  attachmentNames: readonly string[];
  /** 첨부 파일이 있는 폴더. */
  attachmentsDir: string;
}

/** 파일 이름 한 조각의 최대 길이. 프로젝트 이름과 짧은 ID에 각각 적용한다. */
const NAME_PART_MAX = 60;

/** 이름 번호를 이만큼까지 붙여 보고 그래도 겹치면 실패한다. 무한히 도는 것을 막는 상한이다. */
const MAX_NAME_ATTEMPTS = 1000;

/**
 * 진단 보고서를 마크다운 파일로 내보낸다. 파일 이름은 `YYYY-MM-DD-<Sentry 프로젝트 이름>-<짧은 ID>.md`이고 날짜는 오류 이슈를 감지한 날(PC의 시간대)이다.
 * 같은 이름이 있으면 덮어쓰지 않고 `-2`, `-3`을 붙인다. 보고서와 같은 이름의 폴더가 이미 있어도 그 이름은 건너뛰어 첨부가 섞이지 않게 한다.
 * 첨부가 있으면 보고서와 같은 이름의 폴더에 복사하고 상대 링크로 건다. 중간에 실패하면 이번에 만든 파일을 지우고 오류를 던진다.
 */
export async function exportDiagnosisReport({ diagnosis, folder, attachmentNames, attachmentsDir }: ExportDiagnosisOptions): Promise<ExportedDiagnosisReport> {
  /** 내보낼 보고서. */
  const { report } = diagnosis;
  if (!report) throw new Error('내보낼 보고서가 없습니다.');
  await mkdir(folder, { recursive: true });
  /** 이름이 겹치지 않게 잡은 파일. 다른 내보내기와 겹쳐도 같은 이름을 쓰지 않게 배타적으로 만든다. */
  const reserved = await reserveFile(folder, baseName(diagnosis));
  /** 첨부를 복사할 폴더. 첨부가 없으면 만들지 않는다. */
  const attachmentFolder = join(folder, reserved.name);
  try {
    if (attachmentNames.length > 0) {
      await mkdir(attachmentFolder);
      for (const name of attachmentNames) await copyFile(join(attachmentsDir, name), join(attachmentFolder, name));
    }
    await reserved.handle.writeFile(reportMarkdown(diagnosis, report, reserved.name, attachmentNames), 'utf8');
  } catch (error) {
    await reserved.handle.close().catch(() => {});
    await rm(reserved.path, { force: true });
    await rm(attachmentFolder, { recursive: true, force: true });
    throw error;
  }
  await reserved.handle.close();
  return { path: reserved.path, fileName: `${reserved.name}.md` };
}

/** 이름을 잡아 둔 빈 파일. */
interface ReservedFile {
  /** 확장자를 뺀 이름. 첨부 폴더 이름도 이것이다. */
  name: string;
  /** 파일의 절대 경로. */
  path: string;
  /** 쓰기용으로 열어 둔 파일. 부른 쪽이 닫는다. */
  handle: Awaited<ReturnType<typeof open>>;
}

/** `base`, `base-2`, `base-3`… 순서로 아직 없는 이름을 찾아 빈 파일로 만들어 잡는다. 같은 이름의 폴더가 있는 이름은 건너뛴다. */
async function reserveFile(folder: string, base: string): Promise<ReservedFile> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    /** 이번에 시도할 이름. */
    const name = attempt === 1 ? base : `${base}-${attempt}`;
    if (await exists(join(folder, name))) continue;
    /** 이번에 시도할 파일 경로. */
    const path = join(folder, `${name}.md`);
    try {
      // `wx`는 파일이 이미 있으면 실패하므로 확인과 만들기 사이에 같은 이름이 생겨도 덮어쓰지 않는다.
      return { name, path, handle: await open(path, 'wx') };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('보고서 파일 이름을 정하지 못했습니다.');
}

/** 경로에 무언가(파일, 폴더, 깨진 링크)가 있는지 본다. */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** 번호를 붙이기 전의 파일 이름(확장자 없음): `YYYY-MM-DD-<프로젝트 이름>-<짧은 ID>`. */
export function baseName(diagnosis: Pick<SentryDiagnosis, 'detectedAt' | 'issueId' | 'issue'>): string {
  /** 짧은 ID. 없으면 오류 이슈 ID로 대신한다. */
  const shortId = namePart(diagnosis.issue.shortId) || namePart(`issue-${diagnosis.issueId}`);
  return `${dateOf(diagnosis.detectedAt)}-${namePart(diagnosis.issue.projectName) || 'sentry'}-${shortId}`;
}

/** 시각의 날짜(`YYYY-MM-DD`). PC의 시간대로 센다. */
function dateOf(at: number): string {
  /** 시각. */
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 시각(`YYYY-MM-DD HH:mm`). PC의 시간대로 센다. */
function dateTimeOf(at: number): string {
  /** 시각. */
  const date = new Date(at);
  return `${dateOf(at)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 파일 이름에 쓸 수 없는 글자를 `-`로 바꾸고 공백은 `-`로 잇는다. 앞뒤의 `.`과 `-`는 떼고 길이를 줄인다. 남는 것이 없으면 빈 문자열이다. */
function namePart(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- 제어 문자도 파일 이름에 넣지 않는다.
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .slice(0, NAME_PART_MAX)
      .replace(/^[.-]+|[.-]+$/g, '')
  );
}

/** 확신도의 이름. */
const CONFIDENCE_TEXT = { high: '높음', medium: '중간', low: '낮음' } as const;

/** 재현 불가의 까닭 이름. */
const IMPOSSIBLE_REASON_TEXT: Record<ReproductionImpossibleReason, string> = {
  'no-tool': '도구 없음',
  'insufficient-data': '데이터 부족',
  'env-failed': '환경 실패',
  'not-allowed': '허용 안 됨',
  'timed-out': '시간 초과',
};

/** 소스맵 적용 여부의 이름. */
const SOURCE_MAP_TEXT = { applied: '적용됨', failed: '적용 안 됨', unknown: '모름' } as const;

/** 재현 결과의 이름. 불가면 까닭을 괄호로 붙인다. */
function reproductionResultText(reproduction: DiagnosisReproduction): string {
  if (reproduction.result === 'success') return '성공';
  if (reproduction.result === 'failure') return '실패';
  return reproduction.impossibleReason ? `불가(${IMPOSSIBLE_REASON_TEXT[reproduction.impossibleReason]})` : '불가';
}

/** 마크다운 링크의 주소 조각. 경로 조각마다 퍼센트 인코딩해 공백과 괄호가 링크를 깨지 않게 한다. */
function linkTarget(...segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment).replace(/[()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/** 이미지 파일인지 본다. 이미지는 그림으로, 나머지는 링크로 건다. */
function isImage(name: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(name);
}

/** 한 줄 값을 표 칸이나 목록에 안전하게 넣는다. 줄바꿈은 공백으로 줄인다. */
function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

/** 번호 목록. 항목마다 여러 줄이면 다음 줄은 들여쓴다. */
function numbered(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item.replace(/\r?\n/g, '\n   ')}`).join('\n');
}

/** 글머리 목록. 비어 있으면 "없습니다."다. */
function bullets(items: readonly string[]): string {
  return items.length === 0 ? '없습니다.' : items.map((item) => `- ${item.replace(/\r?\n/g, '\n  ')}`).join('\n');
}

/** 근거 한 줄. `번호. 설명 — `저장소 경로/파일:줄``이고 위치를 찾지 못한 근거에는 그 사실을 적는다. */
function evidenceLine(evidence: DiagnosisReport['evidence'][number]): string {
  /** 줄 범위. */
  const lines = evidence.startLine === evidence.endLine ? `${evidence.startLine}` : `${evidence.startLine}-${evidence.endLine}`;
  /** 저장소 폴더 이름. */
  const repository = evidence.repository.split(/[\\/]/).filter(Boolean).at(-1) ?? evidence.repository;
  return `[근거 ${evidence.id}] ${oneLine(evidence.explanation)} — \`${repository}/${evidence.path}:${lines}\`${evidence.located ? '' : ' (위치를 찾을 수 없음)'}`;
}

/** 표 형태의 정보 목록(`- 이름: 값`). 값이 없는 항목은 줄째 뺀다. */
function facts(entries: readonly (readonly [string, string | null])[]): string {
  return entries.flatMap(([label, value]) => (value === null ? [] : [`- ${label}: ${oneLine(value)}`])).join('\n');
}

/**
 * 오류 이슈 정보의 앞선 진단 줄. 검토 대기 중인 앞선 보고서가 있었으면 그 사실을, 완료한 뒤의 재발이면 "앞서 진단함(완료한 날짜)"과
 * 마지막으로 내보낸 파일 경로를 적는다(경로가 없으면 날짜만). 앞선 진단이 없으면 줄이 없다.
 */
function priorDiagnosisFacts(prior: DiagnosisReport['priorDiagnosis']): (readonly [string, string | null])[] {
  if (prior === null) return [];
  if (prior.kind === 'in-review') return [['앞선 진단', '검토 대기 중인 앞선 보고서가 있음']];
  return [['앞선 진단', `앞서 진단함(${dateOf(prior.completedAt)})`], ['앞서 내보낸 파일', prior.exportPath]];
}

/**
 * 보고서를 마크다운으로 쓴다. 순서는 제목 → 요약 → 재현 → 원인과 확신도 → 개선 방향 → 근거 → 남은 의문 → 오류 이슈 정보 → 실행 정보다.
 * "시도한 것"은 재현이 실패·불가일 때만 재현 칸에 넣고, 성공이면 최소화한 재현 순서를 넣는다.
 * 첨부가 있으면 재현 칸 끝에 `<보고서 이름>/<파일>` 상대 링크로 건다.
 */
export function reportMarkdown(diagnosis: SentryDiagnosis, report: DiagnosisReport, name: string, attachmentNames: readonly string[]): string {
  /** 오류 이슈 정보. */
  const { issue } = diagnosis;
  /** 보고서의 재현, 받아 둔 이벤트 정보, 실행 정보. */
  const { reproduction, event, run } = report;
  /** 재현 칸의 줄들. */
  const reproductionLines = [`- 결과: ${reproductionResultText(reproduction)}`];
  if (reproduction.method !== '') reproductionLines.push(`- 방법: ${oneLine(reproduction.method)}`);
  /** 재현 칸에 넣을 순서 또는 시도한 것. */
  const steps = reproduction.result === 'success' ? numbered(reproduction.steps) : reproduction.steps.length > 0 ? `**시도한 것**\n\n${bullets(reproduction.steps)}` : '';
  /** 첨부 링크들. */
  const attachments = attachmentNames.map((file) => `- ${isImage(file) ? '!' : ''}[${file}](${linkTarget(name, file)})`);
  /** 오류 이슈의 수. */
  const counts = [issue.count === null ? null : `${issue.count}회`, issue.userCount === null ? null : `사용자 ${issue.userCount}명`].filter((part) => part !== null);
  /** 에이전트와 CLI 버전. */
  const agent = [AGENT_INFO[run.agent].name, run.cliVersion].filter((part) => part !== null).join(' ');
  /** 보고서의 칸들. */
  const sections = [
    `# ${oneLine(issue.title || issue.shortId)}`,
    `## 요약\n\n${report.summary}`,
    ['## 재현', reproductionLines.join('\n'), steps, attachments.length > 0 ? `**첨부**\n\n${attachments.join('\n')}` : ''].filter((part) => part !== '').join('\n\n'),
    `## 원인과 확신도\n\n확신도: ${CONFIDENCE_TEXT[report.cause.confidence]}\n\n${report.cause.text}`,
    `## 개선 방향\n\n${bullets(report.improvements)}`,
    `## 근거\n\n${report.evidence.length === 0 ? '없습니다.' : bullets(report.evidence.map(evidenceLine))}`,
    `## 남은 의문\n\n${bullets(report.openQuestions)}`,
    `## 오류 이슈 정보\n\n${facts([
      ['Sentry', issue.permalink],
      ['짧은 ID', issue.shortId || null],
      ['조직 / 프로젝트', `${issue.organizationName} / ${issue.projectName}`],
      ['환경', issue.environment ?? '모든 환경'],
      ['레벨', issue.level || null],
      ['신규·재발', `${diagnosis.origin === 'new' ? '신규' : '재발'} · 감지 ${dateTimeOf(diagnosis.detectedAt)}`],
      ['첫 발생', dateTimeOf(issue.firstSeen)],
      ['최근 발생', issue.lastSeen === null ? null : dateTimeOf(issue.lastSeen)],
      ['발생 수', counts.length > 0 ? counts.join(' · ') : null],
      ['release(이벤트 · 최초 · 최근)', [event.release, event.firstRelease, event.lastRelease].map((value) => value ?? '없음').join(' · ')],
      ['플랫폼', issue.platform],
      ['난 자리', issue.culprit || null],
      ['소스맵', SOURCE_MAP_TEXT[event.sourceMaps]],
      ['없는 데이터', event.missingData.length === 0 ? '없음' : event.missingData.join(', ')],
      ...priorDiagnosisFacts(report.priorDiagnosis),
    ])}`,
    `## 실행 정보\n\n${facts([
      ['저장소', run.repository],
      ['HEAD', run.headCommit ?? '모름'],
      ['커밋하지 않은 변경', run.uncommittedChanges === null ? '모름' : run.uncommittedChanges ? '있음' : '없음'],
      ['에이전트', agent],
      ['재현 허용', run.reproductionAllowed ? '허용' : '허용 안 함'],
      ['걸린 시간', `${Math.round(run.durationMs / 1000)}초`],
      ['생성 시각', dateTimeOf(run.createdAt)],
    ])}`,
  ];
  return `${sections.join('\n\n')}\n`;
}
