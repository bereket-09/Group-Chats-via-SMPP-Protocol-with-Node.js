const mongoose = require("mongoose");

const mongoUrl = "mongodb://127.0.0.1:27017/mydb";

mongoose
  .connect(mongoUrl)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));
