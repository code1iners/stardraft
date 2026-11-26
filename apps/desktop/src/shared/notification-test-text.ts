/** [알림 시험]이 띄우는 알림. 준비됨 알림처럼 보이되 묶음을 가리키지 않아 누르면 작은 창만 띄운다. */
export function testNotification(appName: string): { title: string; body: string } {
  return { title: `${appName} 알림 시험`, body: '알림이 이렇게 보입니다. 결과가 준비되면 같은 방식으로 알려 드립니다.' };
}
