/** 재현에서 앱이 고정으로 막는 위험 도구가 있는 서버 하나. */
export interface DeniedToolServer {
  /** 서버 종류 이름. 내부 식별용이다. */
  id: string;
  /** 사용자가 등록한 서버 이름이나 실행 명령에서 이 종류를 알아보는 패턴. 이름 기반이라 완전하지 않다. */
  pattern: RegExp;
  /** 막는 도구 이름. 실은 서버가 어떤 이름이든 이 서버 종류면 이 도구를 막는다. */
  tools: readonly string[];
  /** 이 서버가 외부로 무언가를 보낼 수 있는지 여부(클라우드 기기, 업로드, 원격 측정). 설정 화면의 "외부로 보냄" 꼬리표다. */
  sendsExternally: boolean;
}

/**
 * 고정 deny 목록. 셸이 이미 열려 있으므로 임의 코드 실행을 다 막으려 하지 않고, 셸로는 못 하는 피해
 * (로컬 파일의 외부 업로드, 기기 데이터 파괴, 외부 클라우드 사용, deny 우회)를 막는다. 앱 코드에 고정하고 릴리스로만 바꾼다.
 * 페이지 상태를 읽는 평가 도구, 앱 설치, 빌드·테스트 도구는 막지 않는다.
 */
export const DENIED_TOOL_SERVERS: readonly DeniedToolServer[] = [
  { id: 'playwright', pattern: /playwright/i, tools: ['browser_run_code_unsafe', 'browser_file_upload'], sendsExternally: false },
  {
    id: 'chrome-devtools',
    pattern: /chrome[-_ ]?devtools/i,
    tools: ['upload_file', 'install_extension', 'execute_3p_developer_tool'],
    sendsExternally: true,
  },
  {
    id: 'mobile-mcp',
    pattern: /mobile[-_ ]?mcp|@mobilenext/i,
    tools: [
      'mobile_batch_commands',
      'mobile_uninstall_app',
      'mobile_clear_app_data',
      'mobile_login_to_cloud_provider',
      'mobile_allocate_remote_device',
    ],
    sendsExternally: true,
  },
  {
    id: 'mobile-build-mcp',
    pattern: /mobile[-_ ]?build[-_ ]?mcp|xcodebuildmcp/i,
    tools: ['debug_lldb_command', 'xcode_ide_call_tool', 'erase_sims'],
    sendsExternally: true,
  },
  { id: 'maestro', pattern: /maestro/i, tools: ['run_on_cloud'], sendsExternally: true },
];

/** 서버 이름과 실행 명령(명령·인수·주소)에서 알아본 고정 deny 서버 종류. 알아보지 못하면 `null`. 값(환경 변수, 헤더)은 보지 않는다. */
export function deniedServerFor(identity: string): DeniedToolServer | null {
  return DENIED_TOOL_SERVERS.find((server) => server.pattern.test(identity)) ?? null;
}
