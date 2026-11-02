/** 浏览器可读取的插件状态，不包含凭据和数据库位置。 */
export interface PluginStatus { initialized: boolean; hasProfile: boolean; knowledgeConfigured: boolean; missingConfiguration: string[]; message: string; }
