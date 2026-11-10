const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('menuAPI',{choose:action=>ipcRenderer.send('focus:compact-menu-action',action)});
