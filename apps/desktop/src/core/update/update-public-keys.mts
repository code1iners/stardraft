// 앱 내 업데이트 파일의 서명을 검증하는 Ed25519 공개 키 목록이다. 앱과 태그 워크플로의 서명 재검증이 함께 쓴다.
// `pnpm release:keygen`이 이 파일을 다시 쓴다. 손으로 고치는 것은 키 회전을 마치며 옛 키를 뺄 때뿐이다.
// 목록이 비어 있으면 태그 워크플로가 서명을 검증하지 못해 Release를 만들지 않는다.

/** Ed25519 공개 키(SPKI DER의 base64). 평소에는 하나이고, 키를 회전하는 동안에만 둘이다. */
export const UPDATE_PUBLIC_KEYS: readonly string[] = [
  'MCowBQYDK2VwAyEAONA6ojTWYd+AH6FxwtFXrCIHB70uZ0juj+MDwEQOp80=',
];
