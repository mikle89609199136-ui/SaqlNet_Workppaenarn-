class User {
  constructor({
    id,
    username,
    email = null,
    phone = null,
    avatar = null,
    status = 'offline',
    lastSeen = null,
  }) {
    this.id = id;
    this.username = username;
    this.email = email;
    this.phone = phone;
    this.avatar = avatar;
    this.status = status;
    this.lastSeen = lastSeen ? new Date(lastSeen) : null;
  }

  static fromAPI(data) {
    return new User({
      id: data.id,
      username: data.username ?? data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      avatar: data.avatar ?? data.avatar_url ?? null,
      status: data.status ?? 'offline',
      lastSeen: data.lastSeen ?? data.last_seen ?? null,
    });
  }

  toAPI() {
    return {
      id: this.id,
      username: this.username,
      email: this.email,
      phone: this.phone,
      avatar: this.avatar,
      status: this.status,
      lastSeen: this.lastSeen?.toISOString() ?? null,
    };
  }

  isOnline() {
    return this.status === 'online';
  }

  getDisplayName() {
    return this.username || this.email || this.phone || 'Unknown user';
  }
}

export default User;
