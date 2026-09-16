interface Props {
  title: string;
  message: string;
}

export function ThreadState({ message, title }: Props) {
  return (
    <div className="mx-auto max-w-[360px] text-center px-4.5 py-7 text-ink select-none my-auto">
      <h2 className="text-title font-semibold text-ink mb-2">{title}</h2>
      <p className="text-body text-ink-2">{message}</p>
    </div>
  );
}
