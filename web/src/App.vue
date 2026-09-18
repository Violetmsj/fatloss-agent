<template>
    <RouterView v-slot="{ Component }">
        <component :is="Component" :key="$route.fullPath" />
    </RouterView>
</template>
