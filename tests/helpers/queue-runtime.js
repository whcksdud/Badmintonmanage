const vm = require('node:vm');
const {runApp} = require('./app-runtime');
const roster = (count = 12) => Array.from({length:count}, (_,i) => ({id:i+1,name:`선수${i+1}`,gender:i%2?'F':'M',tier:3,games:0,status:'waiting',lastTime:0,waitingSince:100+i,shuttlecock:false}));
const court = (id=1, extra={}) => ({id,type:'A',active:[],next:[],startTime:null,...extra});
function runtime(state={players:roster(),courts:[court(),court(2)]}, saved=null, now=1000000) {
    const storage = new Map(saved || [['bm_state_v14',JSON.stringify({current:{history:[],members:[],...state},previous:null})]]);
    const elements = new Map(), intervals=[], clock={now};
    class Clock extends Date { constructor(...args){super(...(args.length?args:[clock.now]));} static now(){return clock.now;} }
    const element=()=>({value:'',innerHTML:'',innerText:'',style:{},hidden:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},focus(){},click(){}});
    const math=Object.create(Math);math.random=()=>.5;
    const context=vm.createContext({console,Blob,URL,Date:Clock,Math:math,navigator:{},
        document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(){}},
        window:{navigator:{},matchMedia:()=>({matches:false}),addEventListener(){}},
        localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
        setInterval(fn){intervals.push(fn);},setTimeout(){},clearTimeout(){}});
    runApp(context);
    return {context,storage,elements,clock,run:code=>vm.runInContext(code,context),json:code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,context)),set:(id,value)=>{context.document.getElementById(id).value=value;},tick:()=>intervals.forEach(fn=>fn())};
}
module.exports={runtime,roster,court};
