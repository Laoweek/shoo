// REQ-RULE-11: a Rule name is the user's label and never reaches a Decision model or a chat model.
import { describe, expect, it } from 'vitest';
import { buildChatRequest } from './chat';
import { buildKeepOnlyRequest, buildTextRequest, buildThumbnailRequest } from './decisions';
import { exception, rule, tile } from './testing';

const NAME = 'Zqxv label';
const named = (ref: string, text: string, kind: 'topic' | 'thumbnail' = 'topic') => rule(ref, text, { kind, name: `${NAME} ${ref}` });
const RULES = [named('R1', 'Reaction videos'), named('R2', 'Crypto hype'), named('K1', 'Programming tutorials'), named('R3', 'Shocked faces', 'thumbnail')];
const TILES = [tile('aaaaaaaaaaa', 'Jake reacts to drama', { channelName: 'Jake' }), tile('bbbbbbbbbbb', 'Rust in 10 minutes')];
const EXC = [exception('ccccccccccc', 'Vocal coach reacts', 'Ana', 1)];

describe('Rule name privacy', () => {
  it('appears in no Decisions or chat request body', () => {
    const bodies = [
      buildTextRequest(RULES, EXC, TILES).body, // choice questions and Topic Keep questions
      buildTextRequest(RULES, EXC, TILES, { framing: 'noul' }).body,
      buildKeepOnlyRequest(RULES, TILES).body,
      buildThumbnailRequest(RULES, TILES[0]!, 'data:image/jpeg;base64,AAAA').body,
      buildChatRequest(RULES, EXC, TILES, 'm', 'https://llm.example/v1').body, // the system prompt carries the Rules
    ];
    const json = bodies.map((b) => JSON.stringify(b));
    // The Rules did reach every request, by their text.
    expect(json.every((s) => /Reaction videos|Programming tutorials|Shocked faces/.test(s))).toBe(true);
    for (const s of json) expect(s).not.toContain(NAME);
  });
});
