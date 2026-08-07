export function ThreadSkeleton() {
  return (
    <div className="thread-skeleton">
      <div className="message-bubble">
        <div className="skeleton-line skeleton-message" />
      </div>
      <div className="message-bubble is-mine">
        <div className="skeleton-line skeleton-message-short" />
      </div>
      <div className="message-bubble">
        <div className="skeleton-line skeleton-message" />
      </div>
    </div>
  );
}