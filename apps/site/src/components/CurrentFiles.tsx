import { formatFileSize } from '../lib/format';
import { versionDownloadPath, type InstallerFile, type ReleaseSummary } from '../lib/releases';
import { CopyButton } from './CopyButton';
import { useReleases, type ReleasesState } from './use-releases';

/** OS마다 받은 파일의 SHA256을 확인하는 명령. 브라우저의 기본 다운로드 폴더에 받았다고 본다. */
function hashCommand(file: InstallerFile): { shell: string; command: string } {
  return file.os === 'mac'
    ? { shell: 'macOS 터미널', command: `shasum -a 256 ~/Downloads/${file.name}` }
    : { shell: 'Windows PowerShell', command: `Get-FileHash "$env:USERPROFILE\\Downloads\\${file.name}"` };
}

/** 지금 버전의 설치 파일 표와 확인 명령. */
function FilesTable({ release }: { release: ReleaseSummary }) {
  return (
    <>
      <p>지금 버전 v{release.version}의 파일과 SHA256입니다.</p>
      <table className="files">
        <thead>
          <tr>
            <th>파일</th>
            <th>크기</th>
            <th>SHA256</th>
          </tr>
        </thead>
        <tbody>
          {release.files.map((file) => (
            <tr key={file.os}>
              <td>
                <a className="link" href={versionDownloadPath(release.version, file.os)}>
                  <code>{file.name}</code>
                </a>
              </td>
              <td className="muted">{formatFileSize(file.size)}</td>
              <td>
                {file.sha256 ? (
                  <>
                    <span className="sha" title={file.sha256}>
                      {file.sha256.slice(0, 16)}…
                    </span>
                    <CopyButton text={file.sha256} />
                  </>
                ) : (
                  <span className="muted">GitHub Release 페이지에서 확인</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">받은 파일의 값이 위와 같은지 확인하는 명령입니다.</p>
      <div className="cmds">
        {release.files.map((file) => {
          const { shell, command } = hashCommand(file);
          return (
            <div className="cmd" key={file.os}>
              <span>{shell}</span>
              <code>{command}</code>
              <CopyButton text={command} />
            </div>
          );
        })}
      </div>
    </>
  );
}

/** 지금 버전의 파일 표. 받는 상태를 받아 그리기만 한다. */
export function CurrentFilesView({ state }: { state: ReleasesState }) {
  if (state.status === 'loading') return <p className="muted">파일 정보를 불러오는 중입니다.</p>;
  if (state.status === 'failed') return <p className="muted">파일 정보를 불러오지 못했습니다. 아래 GitHub Release 목록에서 SHA256을 확인하세요.</p>;
  /** 가장 최근 공개 Release. */
  const latest = state.releases[0];
  if (!latest) return <p className="muted">아직 공개된 버전이 없습니다.</p>;
  return <FilesTable release={latest} />;
}

/** 이전 버전과 SHA256 섹션의 지금 버전 파일 표. */
export function CurrentFiles() {
  return <CurrentFilesView state={useReleases()} />;
}
