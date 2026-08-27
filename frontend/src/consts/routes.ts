export const REACT_ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: 'register',
  CHATS: '/chats',
  CHAT_BY_ID: '/chats/:chatId',
  CONTACTS: '/contacts',
  SETTINGS: '/settings',
};

class Routes {
  HOME = '/';

  CHATS = '/chats';
  CHAT_BY_ID = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;

  SETTINGS = '/settings';

  LOGIN = '/login';
  REGISTER = '/register';
  MENU = '/menu';
  CHANNELS = '/channels';
  COMMUNITIES = '/communities';
  MEETINGS = '/meetings';
}

export const ROUTES = new Routes();
