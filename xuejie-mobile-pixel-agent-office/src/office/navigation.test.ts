import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findPath,blocked,homes,stations} from './navigation';
import {AgentEventBus} from '../runtime/model';
test('all six stations reachable without crossing furniture',()=>{homes.forEach((home,i)=>{const path=findPath(home,stations[i]);assert.ok(path?.length);for(const p of path)assert.equal(blocked(p.x,p.y),false);assert.deepEqual(path.at(-1),stations[i]);});});
test('meeting room route uses doorway and avoids occupants',()=>{const start={x:19,y:3};const path=findPath(start,{x:23,y:6},[{x:20,y:3}]);assert.ok(path);assert.ok(path.some(p=>p.x===21&&p.y===5));assert.ok(!path.some(p=>p.x===20&&p.y===3));let prev=start;for(const p of path){assert.equal(Math.abs(p.x-prev.x)+Math.abs(p.y-prev.y),1);prev=p;}});
test('walls reject destinations; blocked routes return null',()=>{assert.equal(findPath(homes[0],{x:0,y:0}),null);assert.equal(findPath({x:2,y:2},{x:3,y:3},[{x:2,y:1},{x:1,y:2},{x:3,y:2},{x:2,y:3}]),null);});
test('event bridge publishes real payloads and unsubscribes',()=>{const bus=new AgentEventBus();let count=0;const off=bus.subscribe(e=>{assert.equal(e.agentId,'translator');count++;});bus.publish({agentId:'translator',status:'WORKING',sequence:1,source:'runtime'});off();bus.publish({agentId:'translator',status:'DONE',sequence:2,source:'runtime'});assert.equal(count,1);});
