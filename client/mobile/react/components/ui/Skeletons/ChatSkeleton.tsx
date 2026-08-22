const array = Array.from({ length: 10 });
export function ChatsSkeleton() {
  return array.map((_item, index) => (
    <div className="chat-row chat-row-skeleton" key={index}>
      <div className="chat-avatar" />
      <div className="chat-main">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />
      </div>
    </div>
  ));
}
