/**
 * Assistant tab — UI shell (DESIGN.md §5.6).
 *
 * Layout-only chat surface. There are no AI replies, and nothing here reads private wallet data.
 */
import { useState } from 'react';
import { useToast } from './toast';
import { PhoneFrame } from './common';
import { SendIcon, SparkleIcon } from './icons';

const PROMPTS = ['Analyze my portfolio', 'Best staking yield', 'Explain TON fees'];

export function AssistantScreen() {
  const toast = useToast();
  const [draft, setDraft] = useState('');

  return (
    <PhoneFrame>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-[96px] pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">Assistant</h1>
          <span className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.02em] text-ink-2 shadow-card">
            <SparkleIcon size={12} />
            Coming soon
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-2xl bg-surface-secondary px-3 py-2.5 text-[12px] font-medium text-ink-2">
          <SparkleIcon size={15} className="shrink-0" />
          The assistant will explain fees, routes and staking in plain language. It never reads your
          keys or recovery phrase.
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[24px] bg-surface px-5 py-10 text-center shadow-card">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-hero text-hero-ink">
            <SparkleIcon size={26} />
          </span>
          <p className="text-[15px] font-bold text-ink">A safe copilot for your wallet</p>
          <p className="max-w-[260px] text-[12.5px] leading-relaxed text-ink-2">
            Ask about balances, fees and staking yields. Private keys and recovery phrases are never
            shared with any model.
          </p>
        </div>

        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                toast.show('Assistant — coming soon');
              }}
              className="pressable shrink-0 rounded-full bg-surface px-3.5 py-2 text-[12px] font-semibold text-ink shadow-card"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-full bg-surface p-1.5 shadow-card">
          <input
            aria-label="Message the assistant"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            disabled
            placeholder="Assistant coming soon"
            className="min-w-0 flex-1 bg-transparent px-3 text-[14px] text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="button"
            disabled
            aria-label="Send message"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-secondary text-ink-muted"
          >
            <SendIcon size={16} />
          </button>
        </div>
      </main>
    </PhoneFrame>
  );
}
