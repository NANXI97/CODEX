import {createServer}from'node:http';
import {TaskStore}from'./store';
import {AgentRuntime}from'./runtime';
import {readProviderConfig,OpenAIResponsesProvider}from'./provider';
import {createApp}from'./app';
import {FileStore}from'./files';
const config=readProviderConfig();
const port=Number(process.env.API_PORT??3001),server=createServer();
let store:TaskStore|undefined;
// Bind first: a second startup must not rewrite the live backend's task state.
server.once('listening',()=>{
 try{
  store=new TaskStore(process.env.TASK_DB_PATH??'.local/tasks.sqlite');
  const runtime=new AgentRuntime(store,config?new OpenAIResponsesProvider(config):null,{files:new FileStore(process.env.UPLOAD_DIR??'.local/uploads')});
  server.on('request',createApp(runtime));
  console.log(`Agent Runtime listening on ${port}; LLM ${config?'configured':'not configured (no simulated task execution)'}`);
 }catch{console.error('Agent Runtime initialization failed; check local storage configuration.');server.close();store?.close();process.exitCode=1;}
});
server.once('error',()=>{console.error('Agent Runtime failed to bind its port; check whether an existing backend is running.');process.exitCode=1;});
server.listen(port,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{server.close();process.exit(0);});
