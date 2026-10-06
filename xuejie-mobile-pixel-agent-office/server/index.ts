import {TaskStore}from'./store';
import {AgentRuntime}from'./runtime';
import {readProviderConfig,OpenAIResponsesProvider}from'./provider';
import {createApp}from'./app';
const config=readProviderConfig();const store=new TaskStore(process.env.TASK_DB_PATH??'.local/tasks.sqlite');
const runtime=new AgentRuntime(store,config?new OpenAIResponsesProvider(config):null);
const port=Number(process.env.API_PORT??3001);const server=createApp(runtime).listen(port,'127.0.0.1',()=>console.log(`Agent Runtime listening on ${port}; LLM ${config?'configured':'not configured (no simulated task execution)'}`));
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{server.close();process.exit(0);});
