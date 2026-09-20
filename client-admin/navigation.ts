export interface Page {
  id: string;
  name: string;
  table?: string;
  group?: string;
}
export interface Module {
  id: string;
  name: string;
  icon: string;
  pages: Page[];
  groups?: { id: string; name: string; page: string }[];
}

export const modules: Module[] = [
  {
    id: "home",
    name: "首页",
    icon: "home",
    pages: [{ id: "home", name: "预览与导航" }],
  },
  {
    id: "characters",
    name: "角色管理",
    icon: "cat",
    groups: [
      { id: "cats", name: "猫猫", page: "characters" },
      { id: "managers", name: "店长", page: "manager-characters" },
    ],
    pages: [
      { id: "characters", name: "角色与动作", group: "cats" },
      {
        id: "character-config",
        name: "可选角色",
        table: "characters",
        group: "cats",
      },
      { id: "cat-ai", name: "AI 策略", table: "cat_ai", group: "cats" },
      { id: "manager-characters", name: "角色与动作", group: "managers" },
      { id: "manager", name: "成长数值", table: "manager", group: "managers" },
      {
        id: "manager-ai",
        name: "AI 策略",
        table: "manager_ai",
        group: "managers",
      },
    ],
  },
  {
    id: "maps",
    name: "地图管理",
    icon: "map",
    pages: [
      { id: "maps", name: "地图生成" },
      { id: "themes", name: "主题贴图" },
      { id: "map-items", name: "默认开局物资", table: "map_items" },
    ],
  },
  {
    id: "items",
    name: "道具管理",
    icon: "box",
    pages: [
      { id: "items", name: "道具列表" },
      { id: "doors", name: "店门", table: "doors" },
      { id: "nests", name: "罐头窝", table: "nests" },
      { id: "random-items", name: "随机道具", table: "random_items" },
    ],
  },
  {
    id: "audio",
    name: "音效管理",
    icon: "audio",
    pages: [{ id: "audio", name: "音效与音乐" }],
  },
  {
    id: "resources",
    name: "资源管理",
    icon: "image",
    pages: [
      { id: "resources", name: "资源库" },
      { id: "clients", name: "客户端接入" },
    ],
  },
  {
    id: "tables",
    name: "总表管理",
    icon: "table",
    pages: [
      { id: "tables", name: "全部配表" },
      { id: "history", name: "发布历史" },
    ],
  },
];

export function locationFor(page: string) {
  const module =
    modules.find((m) => m.pages.some((p) => p.id === page)) ?? modules[0];
  return {
    module,
    page: module.pages.find((p) => p.id === page) ?? module.pages[0],
  };
}

const paths: Record<string, string> = {
  audio:
    '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  cat: '<path d="M4 11V4l5 3a12 12 0 0 1 6 0l5-3v7c3 12-19 12-16 0Z"/><path d="M8 12h.01M16 12h.01m-5 3h2l-1 1Z"/>',
  map: '<path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2Zm6-2v15m6-12v15"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8Zm0 10v9M3 8l9 5 9-5M8 5l9 5"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m3 18 5-4 4 3 4-6 5 6"/>',
  table:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 9v12"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
};
export function icon(name: string) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.table}</svg>`;
}
