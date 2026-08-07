export function ThreadState({ message, title }) {
  return (
    <div className="thread-state">
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}
