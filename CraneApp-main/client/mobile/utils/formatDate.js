/**
 * Date formatting utilities
 */

export function formatDate(timestamp, options = {}) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // Less than a minute
  if (diff < 60000) {
    return 'Just now';
  }

  // Less than an hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  // Today
  if (isToday(date)) {
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  // Yesterday
  if (isYesterday(date)) {
    return 'Yesterday';
  }

  // This week
  if (isThisWeek(date)) {
    return date.toLocaleDateString([], { 
      weekday: 'short' 
    });
  }

  // This year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { 
      day: 'numeric', 
      month: 'short' 
    });
  }

  // Older
  return date.toLocaleDateString([], { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  });
}

export function isToday(date) {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

export function isYesterday(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.toDateString() === yesterday.toDateString();
}

export function isThisWeek(date) {
  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  return date >= weekAgo && date <= now;
}

export function formatRelativeTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  
  return date.toLocaleDateString();
}