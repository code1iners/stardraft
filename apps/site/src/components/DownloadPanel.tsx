import type { ReactNode } from 'react';
import { formatFileSize, formatReleaseDate } from '../lib/format';
import { announceInstallOs } from '../lib/install-os';
import { INSTALLER_OS_NAMES, latestDownloadPath, SITE_URL, type InstallerFile, type InstallerOs, type ReleaseSummary } from '../lib/releases';
import { visitorOs, type Visitor } from '../lib/visitor';
import { CopyButton } from './CopyButton';

/** OS마다 지원 환경 문구. */
const SUPPORT_TEXT: Record<InstallerOs, string> = {
  mac: 'Apple Silicon Mac · macOS 13 이상',
  windows: 'Windows 10 이상 · x64',
};

/** 다운로드 자리가 받는 것. */
type Props = {
  /** 감지한 방문 환경. JS가 돌기 전이거나 아직 감지하지 못했으면 null. */
  visitor: Visitor | null;
  /** 가장 최근 공개 Release. 아직 받지 못했거나 받지 못하면 null. */
  latest: ReleaseSummary | null;
};

/** Release에서 OS의 설치 파일. */
function installerOf(release: ReleaseSummary | null, os: InstallerOs | null): InstallerFile | undefined {
  return release?.files.find((file) => file.os === os);
}

/** 지원 OS 두 개의 지원 환경 한 줄. */
function BothSupportLine() {
  return (
    <p className="support">
      {SUPPORT_TEXT.mac} / {SUPPORT_TEXT.windows}
    </p>
  );
}

/** 다운로드 링크. 누르면 설치 안내의 OS 탭도 그 OS로 바뀐다. */
function DownloadLink({ os, label, primary = false }: { os: InstallerOs; label: string; primary?: boolean }) {
  return (
    <a className={primary ? 'btn primary lg' : 'btn'} href={latestDownloadPath(os)} onClick={() => announceInstallOs(os)}>
      {label}
    </a>
  );
}

/** 글 사이의 다운로드 링크. 다른 OS용 받기도 이것이라, 누르면 설치 안내의 OS 탭이 그 OS로 바뀐다. */
function TextDownloadLink({ os, label }: { os: InstallerOs; label: string }) {
  return (
    <a className="link" href={latestDownloadPath(os)} onClick={() => announceInstallOs(os)}>
      {label}
    </a>
  );
}

/** 지원 OS 두 버튼과 두 지원 환경. 감지 전과 그 밖의 OS에서 쓴다. */
function BothOses() {
  return (
    <>
      <div className="dl-row">
        <DownloadLink os="mac" label="macOS용 다운로드" />
        <DownloadLink os="windows" label="Windows용 다운로드" />
      </div>
      <BothSupportLine />
    </>
  );
}

/** 감지한 OS의 대표 버튼과 그 밑의 지원 환경·크기, 다른 OS용 링크. */
function PrimaryDownload({ os, latest, hint }: { os: InstallerOs; latest: ReleaseSummary | null; hint: ReactNode }) {
  /** 다른 OS. */
  const other: InstallerOs = os === 'mac' ? 'windows' : 'mac';
  /** 이 OS 설치 파일. */
  const file = installerOf(latest, os);
  return (
    <>
      <div className="dl-row">
        <DownloadLink os={os} label={`${INSTALLER_OS_NAMES[os]}용 다운로드`} primary />
      </div>
      <p className="support">{file ? `${SUPPORT_TEXT[os]} · ${formatFileSize(file.size)}` : SUPPORT_TEXT[os]}</p>
      {hint && <p className="hint">{hint}</p>}
      <p className="other">
        <TextDownloadLink os={other} label={`${INSTALLER_OS_NAMES[other]}용 받기`} />
      </p>
    </>
  );
}

/** 방문 환경마다 다운로드 자리. */
function DownloadChoice({ visitor, latest }: Props) {
  switch (visitor) {
    case null:
      return <BothOses />;
    case 'mac-arm':
      return <PrimaryDownload os="mac" latest={latest} hint={null} />;
    case 'mac-unknown':
      return (
        <PrimaryDownload
          os="mac"
          latest={latest}
          hint={
            <>
              이 브라우저에서는 Mac의 칩을 확인할 수 없습니다. <b>Apple 메뉴 &gt; 이 Mac에 관하여</b>에 ‘칩’이 보이면 Apple Silicon입니다. ‘프로세서’가
              보이면 Intel Mac이라 실행되지 않습니다.
            </>
          }
        />
      );
    case 'mac-intel':
      return (
        <>
          <p className="note warn">
            <b>이 Mac은 Intel 칩으로 보입니다.</b> Stardraft는 Apple Silicon Mac에서만 실행됩니다. Intel Mac용 파일은 없습니다.
          </p>
          <p className="other">
            <TextDownloadLink os="mac" label="그래도 macOS용 받기" /> · <TextDownloadLink os="windows" label="Windows용 받기" />
          </p>
        </>
      );
    case 'windows':
      return <PrimaryDownload os="windows" latest={latest} hint={null} />;
    case 'windows-arm':
      return (
        <PrimaryDownload
          os="windows"
          latest={latest}
          hint="ARM 기반 Windows PC에서는 Windows 11의 x64 에뮬레이션으로 실행됩니다."
        />
      );
    case 'mobile':
      return (
        <>
          <p className="dl-msg">
            <b>휴대폰에서는 설치할 수 없습니다.</b> Mac이나 Windows PC에서 이 주소를 여세요.
          </p>
          <div className="dl-row">
            <CopyButton text={SITE_URL} label="PC에서 열 링크 복사" look="primary" />
          </div>
          <BothSupportLine />
        </>
      );
    case 'other':
      return (
        <>
          <p className="dl-msg">
            <b>이 OS용 Stardraft는 없습니다.</b> Mac과 Windows만 지원합니다.
          </p>
          <BothOses />
        </>
      );
  }
}

/** 버전·날짜, 변경 내역 링크, SHA256 복사 한 줄. */
function VersionLine({ visitor, latest }: Props) {
  /** SHA256을 복사해 줄 설치 파일. 받을 OS가 정해진 방문 환경에서만. */
  const file = installerOf(latest, visitorOs(visitor));
  return (
    <p className="ver">
      {latest && (
        <span>
          v{latest.version} · {formatReleaseDate(latest.date)}
        </span>
      )}
      <a className="link" href="#changelog">
        변경 내역
      </a>
      {file?.sha256 && <CopyButton text={file.sha256} label="SHA256 복사" look="link" />}
    </p>
  );
}

/** 첫 화면 왼쪽의 다운로드 자리. 방문 환경과 최신 Release를 받아 그리기만 한다. */
export function DownloadPanel({ visitor, latest }: Props) {
  return (
    <div className="dl">
      <DownloadChoice visitor={visitor} latest={latest} />
      <VersionLine visitor={visitor} latest={latest} />
    </div>
  );
}
