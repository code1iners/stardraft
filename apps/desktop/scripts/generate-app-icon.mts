import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

/** 승인된 채움 트레이 문양. 앱 아이콘은 상태와 무관하게 이 형태를 유지한다. */
const source = await readFile(new URL('../resources/tray/review.svg', import.meta.url), 'utf8');
/** 작은 트레이용 문양을 앱 아이콘의 중앙에 배치한다. */
const mark = source.replace(/<svg[^>]*>/, '').replace('</svg>', '');
/** 밝은 바탕을 둬 Finder의 밝은 테마와 어두운 테마에서 모두 문양을 읽을 수 있게 한다. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="64" y="64" width="896" height="896" rx="200" fill="#f2f2f2"/><g transform="translate(224 224) scale(24)" color="#272b32">${mark}</g></svg>`;
/** electron-builder가 macOS ICNS와 Windows ICO로 변환할 공통 원본. */
const generated = await sharp(Buffer.from(svg)).png().toBuffer();
/** 빌드 전용 자산 폴더. 앱 실행 시에는 원본 PNG가 필요하지 않다. */
const directory = new URL('../build/', import.meta.url);
/** 커밋한 원본 이미지. */
const target = new URL('icon.png', directory);

if (process.argv.includes('--check')) {
  if (!(await readFile(target)).equals(generated)) {
    throw new Error('앱 아이콘이 승인된 트레이 문양과 다릅니다. pnpm app-icon:generate를 실행하세요.');
  }
} else {
  await mkdir(directory, { recursive: true });
  await writeFile(target, generated);
}
