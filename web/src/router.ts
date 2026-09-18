import { createRouter, createWebHistory } from "vue-router";

import ChatView from "./views/ChatView.vue";
import OnboardingView from "./views/OnboardingView.vue";
import ProfileView from "./views/ProfileView.vue";
import StartView from "./views/StartView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: StartView },
    { path: "/onboarding", component: OnboardingView },
    { path: "/chat/:conversationId", component: ChatView },
    { path: "/profile", component: ProfileView },
  ],
});
