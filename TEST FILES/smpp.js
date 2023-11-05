const express = require("express");
const app = express();

const bodyParser = require("body-parser");

app.use(bodyParser.json());

var smpp = require("smpp");
var session = smpp.connect(
  {
    url: "smpp://127.0.0.1:2776",
    // auto_enquire_link_period: 1000000,
    debug: true,
  },
  function () {
    session.bind_transceiver(
      {
        system_id: "test",
        password: "test",
      },
      function (pdu) {
        if (pdu.command_status === 0) {
          // Successfully bound
          //   session.submit_sm(
          //     {
          //       destination_addr: "DESTINATION NUMBER",
          //       short_message: "Hello!",
          //     },
          //     function (pdu) {
          //       if (pdu.command_status === 0) {
          //         // Message successfully sent
          //         console.log("SUCCESS", pdu.message_id);
          //       }
          //     }
          //   );
        }
      }
    );
  }
);

// function extractShortcodeFromMessage(message) {
//   // Extract the shortcode from the message
//   // This implementation assumes that the shortcode is the first 6 characters of the message
//   const shortcode = message.substring(0, 6);
//   return shortcode;
// }

// function removeShortcodeFromMessage(message, shortcode) {
//   // Remove the shortcode from the message
//   const messageWithoutShortcode = message.substring(6).trim();
//   return messageWithoutShortcode;
// }


app.post("/send-sms", (req, res) => {
  const destinationNumber = req.body.destinationNumber;
  const message = req.body.message;

  console.log("Data shared : ", req.body);
  session.submit_sm(
    {
      destination_addr: destinationNumber,
      short_message: message,
    },
    function (pdu) {
      if (pdu.command_status === 0) {
        // Message successfully sent
        console.log("SUCCESS", pdu.message_id);
        res.status(200).send("SMS message sent successfully.");
      } else {
        console.log("ERROR", pdu);
        res.status(500).send("Failed to send SMS message.");
      }
    }
  );
});

app.listen(30000, () =>
  console.log("Group chat API is listening on port 3000.")
);
