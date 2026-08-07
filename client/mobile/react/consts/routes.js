export const REACT_ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  REGISTER: "register",
  CHATS: "/chats",
  CHAT_BY_ID: "/chats/:chatId",
  CONTACTS: "/contacts",
  SETTINGS: "/settings",
  CREATE_GROUP: "/create-group",
};

class Routes {
  HOME = "/";

  CHATS = "/chats";
  CHAT_BY_ID = (chatId) => `/chats/${encodeURIComponent(chatId)}`;

  SETTINGS = "/settings";
  CREATE_GROUP = "/create-group";

  LOGIN = "/login";
  REGISTER = "/register";

  CHANNELS = "/channels";
  COMMUNITIES = "/communities";
  MEETINGS = "/meetings";
}

export const ROUTES = new Routes();
