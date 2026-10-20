import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStateDatabase, STATE_MIGRATIONS } from './state-database';

/** 테스트마다 만드는 임시 폴더. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stardraft-state-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// 상태 저장소 포트에는 아직 행을 지우는 동작이 없어서, 연 DB에 지울 행을 직접 만들어 검사한다.
// 한 줄짜리 값을 덮어쓰는 것만으로는 secure_delete를 꺼도 흔적이 남지 않아 구분되지 않는다.
describe('state.db 연결', () => {
  it('지운 행의 내용이 state.db 파일에 남지 않는다(secure_delete)', () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    db.exec('CREATE TABLE mentions (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
    /** 행 하나를 넣는 문장. */
    const insert = db.prepare('INSERT INTO mentions (body) VALUES (?)');
    for (let index = 0; index < 20; index += 1) insert.run(`가짜 본문 ${index} ${'x'.repeat(40)}`);
    insert.run(`지울 가짜 본문 ${'m'.repeat(40)}`);

    db.prepare('DELETE FROM mentions WHERE body LIKE ?').run('지울%');
    db.close();

    expect(readFileSync(path).includes(Buffer.from('지울 가짜 본문'))).toBe(false);
    expect(readFileSync(path).includes(Buffer.from('가짜 본문 19'))).toBe(true);
  });
});
