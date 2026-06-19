const express = require('express');
const app = express(); // express의 모든기능을 app에 담아줌

app.use(express.static('public'));
app.use(express.urlencoded({extended : true}));

app.set("view engine", "ejs"); // 지금부터 페이지는 ejs로 만들거야
app.set("views", __dirname+"/views"); // 큰 폴더 아래 views로 찾아가


app.listen(3000);