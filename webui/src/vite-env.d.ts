/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock'（默认，开发期替身）| 'http'（本机服务进程） */
  readonly VITE_API_MODE?: 'mock' | 'http';
  /** 本机服务接口前缀，默认 /api */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
