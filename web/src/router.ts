import { createRouter, createWebHistory } from "vue-router";

import ChatView from "./views/ChatView.vue";
import OnboardingView from "./views/OnboardingView.vue";
import ProfileView from "./views/ProfileView.vue";
import StartView from "./views/StartView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    // 根页面只负责判断画像与最近会话，真正业务页面使用明确 URL，刷新后仍可恢复。
    { path: "/", component: StartView },
    { path: "/onboarding", component: OnboardingView },
    { path: "/chat/:conversationId", component: ChatView },
    { path: "/profile", component: ProfileView },
  ],
});
