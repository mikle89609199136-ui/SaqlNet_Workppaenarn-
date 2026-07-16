class Chat {
  constructor({
    id,
    name,
    type = 'private',
    peerId = null,
    peerIsOnline = false,
    peerLastSeen = '',
    participants = [],
    lastMessage = null,
    unreadCount = 0,
    createdAt = new Date(),
  }) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.peerId = peerId;
    this.peerIsOnline = peerIsOnline;
    this.peerLastSeen = peerLastSeen;
    this.participants = participants;
    this.lastMessage = lastMessage;
    this.unreadCount = unreadCount;
    this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
  }

  static fromAPI(data) {
    return new Chat({
      id: data.id,
      name: data.name ?? data.title,
      type: data.type ?? 'private',
      peerId: data.peerId ?? data.peer_id ?? null,
      peerIsOnline: data.peerIsOnline ?? data.peer_is_online ?? false,
      peerLastSeen: data.peerLastSeen ?? data.peer_last_seen ?? '',
      participants: data.participants ?? [],
      lastMessage: data.lastMessage ?? data.last_message ?? null,
      unreadCount: data.unreadCount ?? data.unread_count ?? 0,
      createdAt: data.createdAt ?? data.created_at ?? new Date(),
    });
  }

  toAPI() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      peerId: this.peerId,
      peerIsOnline: this.peerIsOnline,
      peerLastSeen: this.peerLastSeen,
      participants: this.participants,
      lastMessage: this.lastMessage,
      unreadCount: this.unreadCount,
      createdAt: this.createdAt.toISOString(),
    };
  }

  isGroup() {
    return this.type === 'group';
  }

  hasUnread() {
    return this.unreadCount > 0;
  }

  addParticipant(userId) {
    if (!this.participants.includes(userId)) {
      this.participants.push(userId);
    }
  }

  removeParticipant(userId) {
    this.participants = this.participants.filter((id) => id !== userId);
  }
}

export default Chat;
