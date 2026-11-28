self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{const d=e.data?e.data.json():{title:"Desk"};
  e.waitUntil(self.registration.showNotification(d.title||"Desk",{body:d.body||"",data:{url:d.url||"./"}}));});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(clients.openWindow(e.notification.data.url));});
