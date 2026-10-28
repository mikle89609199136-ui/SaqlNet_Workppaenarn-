import { expect, it } from 'vitest';
import { makeMessage, makePin } from '@/test/fixtures';
import { mergePins } from './mergePins';

it('объединяет обе области без дубля и сохраняет каждое состояние независимо', () => {
  const pin = makePin({ message: makeMessage({ id: 'pinned' }) });
  const both = mergePins([pin], [pin]);
  expect(both).toHaveLength(1);
  expect(both[0].message).toMatchObject({
    isChatPinned: true,
    isPersonalPinned: true,
    isPinned: true,
  });
  expect(mergePins([], [pin])[0].message).toMatchObject({
    isChatPinned: false,
    isPersonalPinned: true,
    isPinned: false,
  });
  expect(mergePins([pin], [])[0].message).toMatchObject({
    isChatPinned: true,
    isPersonalPinned: false,
    isPinned: true,
  });
});
