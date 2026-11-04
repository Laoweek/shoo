// Test helper: the consent disclosure (src/ui/pages/Disclosure.tsx) must carry every REQ-PRIV-1 fact
// the consent states, in the right row and list, and nothing else (docs/spec/requirements.md Section 14).
// Each row is listed exactly, so a fact that goes missing, moves rows or lists, or gets added fails the test.
import { expect } from 'vitest';
import { text } from './render';

/** `lists` holds one entry per `ul` in the row, in order, each with its `li` texts. */
export const DISCLOSURE_ROWS: { title: string; lines?: string[]; lists: string[][] }[] = [
  {
    title: 'For each video Shoo checks',
    lists: [['Title', 'Channel name', 'Length', "Where it appeared: YouTube's Home, Watch sidebar or Shorts shelf, or Bilibili's Home", 'Thumbnail image, only if you create a Thumbnail rule']],
  },
  {
    title: 'Also in each request',
    lists: [
      [
        'The text of your Topic and Thumbnail rules, and of Keep rules you wrote as a sentence, while they are on',
        'Titles and channel names of up to 10 videos you chose to keep',
      ],
    ],
  },
  {
    title: 'Who receives it',
    // The second group replaces OpenRouter, so a recipient that moves between the groups changes the consent.
    lines: ['OpenRouter (openrouter.ai), which passes it to the model provider', 'Instead of OpenRouter only if you choose one, and Shoo names its address first'],
    lists: [
      [
        'Cloudflare by default, with the model cloudflare/clef-flash',
        'TypeSafe if Shoo falls back to the model typesafe/jev-1.13',
        'OpenAI if a thumbnail check falls back to openai/gpt-6-luna-decisions',
        'The provider of another model if you pick one in Settings',
      ],
      [
        'Cloudflare, TypeSafe or Perplexity reached directly with your own key',
        'A model on this computer (Ollama, llama.cpp or LM Studio), so nothing leaves your device',
        'Your own endpoint if you set one up',
      ],
    ],
  },
  {
    title: 'Never sent to any of them',
    lists: [
      [
        'Web addresses',
        "Video IDs, including Bilibili's BV ids",
        'Channel IDs and handles',
        'Your YouTube subscriptions',
        'Your watch history',
        'Cookies',
        'Comments',
        "The page's HTML",
        'Your YouTube or Bilibili account details',
      ],
    ],
  },
];

/** Asserts the disclosure rows under `root`, with row titles at heading `level`. */
export function expectDisclosure(root: Element, level: 3 | 4 = 4): void {
  const headings = [...root.querySelectorAll(`h${level}`)].filter((h) => DISCLOSURE_ROWS.some((r) => r.title === text(h)));
  expect(headings.map(text)).toEqual(DISCLOSURE_ROWS.map((r) => r.title));
  DISCLOSURE_ROWS.forEach((row, i) => {
    const el = headings[i]!.parentElement!;
    const lists = [...el.querySelectorAll('ul')].map((ul) => [...ul.querySelectorAll('li')].map(text));
    expect(lists).toEqual(row.lists);
    expect([...el.querySelectorAll('p')].map(text)).toEqual(row.lines ?? []);
  });
}
