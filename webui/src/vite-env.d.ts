/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 本机服务接口前缀（默认 /api；同源托管时无需设置） */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
