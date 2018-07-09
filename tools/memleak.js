const PG = require('../');

let str;
let counter = 0;

const iter = ()=>{
  str = "x"+ (++counter).toString(36);
};

const loop1 = ()=>{
  let i = 0;

  const select = ()=>{
    const pg = new PG(err => {// err && exit(err)
                             });
    pg.finish();
    if (++i < 1000)
      setTimeout(select, 0);
    else
      setTimeout(loop, 5);
  };

  select();
};

const exit = (err)=>{
  console.log(err);
  process.exit(1);
};


const loop2 = ()=>{
  const pg = new PG(err => {err && exit(err)});
  let i = 0;

  const select = ()=>{
    pg.exec('SELECT 1', (err, res)=>{
      err && exit(err);
      counter += res[0]['?column?'];
      if (++i < 1000) select();
      else {
        pg.finish();
        setTimeout(loop, 5);
      }
    });
  };

  select();
};

const loop = loop1;

loop();
