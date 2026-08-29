interface Props {
  title: string;
  message: string;
}

export function ThreadState({ message, title }: Props) {
  return (
    <div className="thread-state">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}
