import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { captureLaunchToken, restoreLaunchToken, stripTokenFromHash } from '@/api/client';
import './index.css';

/* 启动令牌：从 URL fragment 解析并存入 sessionStorage（刷新保留、关闭标签页清除），
   随后将令牌从地址栏抹去（详设 §4.1）；刷新后的页面回退读取会话存储。 */
captureLaunchToken();
restoreLaunchToken();
stripTokenFromHash();

/* 支持「在已打开的页面里直接粘贴入口地址」：只有 fragment 变化时不触发整页加载，
   监听 hashchange，一旦出现令牌就立刻捕获并抹去即可（无令牌的路由切换不受影响）。 */
window.addEventListener('hashchange', () => {
  if (captureLaunchToken() !== null) stripTokenFromHash();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
