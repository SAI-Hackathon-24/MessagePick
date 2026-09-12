import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { captureLaunchToken, stripTokenFromHash } from '@/api/client';
import './index.css';

/* 启动令牌：从 URL fragment 解析（只在内存持有），随后将令牌从地址栏抹去（详设 §4.1）。 */
captureLaunchToken();
stripTokenFromHash();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
