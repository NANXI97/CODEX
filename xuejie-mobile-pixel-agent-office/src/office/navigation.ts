export interface Point {x:number;y:number}
export const width=30, height=20;
export const stations:Point[]=[{x:4,y:6},{x:10,y:6},{x:16,y:6},{x:4,y:12},{x:10,y:12},{x:16,y:12}];
export const homes:Point[]=[{x:4,y:8},{x:10,y:8},{x:16,y:8},{x:4,y:14},{x:10,y:14},{x:16,y:14}];
export function blocked(x:number,y:number):boolean {
 if(x<1||y<1||x>=width-1||y>=height-1) return true;
 if(stations.some(p=>y===p.y-1&&x>=p.x-1&&x<=p.x+1)) return true;
 if((x===23||x===28)&&(y===3||y===4))return true;
 if((x===25||x===26)&&y===13)return true;
 if(x===21&&y<16&&y!==5&&y!==12) return true;
 if(x>21&&y===8&&x!==25) return true;
 if(x>=24&&x<=27&&(y===3||y===4||y===11||y===17)) return true;
 return false;
}
export function findPath(start:Point,end:Point,occupied:Point[]=[]):Point[]|null {
 const key=(p:Point)=>`${p.x},${p.y}`;
 if(blocked(end.x,end.y))return null;
 const queue=[start], previous=new Map<string,Point|null>([[key(start),null]]);
 for(let i=0;i<queue.length;i++) {
  const p=queue[i]; if(key(p)===key(end)){const path:Point[]=[];let current:Point|null=p;while(current&&key(current)!==key(start)){path.unshift(current);current=previous.get(key(current))??null;}return path;}
  for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]) {const n={x:p.x+dx,y:p.y+dy};if(!blocked(n.x,n.y)&&!occupied.some(o=>key(o)===key(n))&&!previous.has(key(n))){previous.set(key(n),p);queue.push(n);}}
 }
 return null;
}
