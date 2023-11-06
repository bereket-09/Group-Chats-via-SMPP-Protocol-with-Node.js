const express = require("express");
const bodyParser = require("body-parser");
const smpp = require("smpp");
const crypto = require("crypto");
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.json());

const mongoUrl = "mongodb://127.0.0.1:27017/group-chat-db";

mongoose
  .connect(mongoUrl)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

const Group = mongoose.model("Group", {
  groupName: String,
  shortcode: String,
  groupOwner: String, // Added group owner field
  members: [String], // Renamed from 'users' to 'members'
  chatHistory: [
    {
      timestamp: Date,
      sourceAddr: String,
      message: String,
    },
  ],
});

const User = mongoose.model("User", {
  username: String,
  groups: [
    {
      group_id: { type: mongoose.Schema.Types.ObjectId, ref: "Group" },
      shortcode: String,
      dateAdded: Date,
    },
  ],
});

// SMPP credentials
const smppConfig = {
  url: "smpp://127.0.0.1:2776",
  auto_enquire_link_period: 100000000,
  debug: true,
};

// Create the SMPP session and bind to the SMPP server
const session = smpp.connect(smppConfig, function () {
  session.bind_transceiver(
    {
      system_id: "test",
      password: "test",
    },
    function (pdu) {
      if (pdu.command_status === 0) {
        // Successfully bound
        console.log("\n \n SMPP BIND SUCCESSFULLY \n\n");
      }
    }
  );
});

// Send SMS Message endpoint
app.post("/groups/send-sms", async (req, res) => {
  const shortcode = req.body.shortcode;
  const message = req.body.message;
  let sender = req.body.sender;

  // Validate and format the sender
  sender = formatUser(sender);
  if (!validateUser(sender)) {
    res
      .status(400)
      .json({ code: 400, success: false, message: "Invalid sender" });
    return;
  }

  try {
    const group = await Group.findOne({ shortcode });
    if (!group) {
      res
        .status(404)
        .json({ code: 404, success: false, message: "Group not found" });
      return;
    }

    // Check if the sender is part of the group
    if (!group.members.includes(sender)) {
      res.status(400).json({
        code: 400,
        success: false,
        message: "Sender not in the group",
      });
      return;
    }

    // Get the list of users in the group
    const users = group.members;

    // Send SMS messages to all users except the sender
    for (const user of users) {
      if (user === sender) {
        continue;
      }
      const submitSm = {
        source_addr: shortcode,
        destination_addr: user,
        short_message: `From ${sender}: \n ${message}`,
      };
      session.submit_sm(submitSm, (err) => {
        if (err) {
          console.error(err);
        }
      });
    }

    // Add message to chat history for the group
    const messageObj = {
      timestamp: new Date(),
      sourceAddr: sender,
      message: message,
    };
    group.chatHistory.push(messageObj);
    await group.save();

    // Construct the updated response body
    const responseBody = {
      code: 200,
      success: true,
      message: "SMS sent successfully",
      shortcode: shortcode,
      number_of_receivers: users.length - 1,
      // group: group,
      chatHistory: group.chatHistory,
    };

    res.status(200).json(responseBody);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Error sending SMS",
      error: err,
      code: 500,
    });
  }
});

// Create Group endpoint
app.post("/groups/create", async (req, res) => {
  const groupData = req.body;
  const groupOwner = groupData.members[0]; // First user in the request body

  let shortcode = generateShortcode(groupData.groupName);
  groupData.shortcode = shortcode;
  groupData.groupOwner = groupOwner; // Set the group owner

  let isUnique = false;
  while (!isUnique) {
    try {
      const existingGroup = await Group.findOne({ shortcode });
      if (!existingGroup) {
        isUnique = true;
      } else {
        shortcode = generateShortcode(groupData.groupName);
        groupData.shortcode = shortcode;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({
        code: 500,
        success: false,
        message: "Error checking group shortcode uniqueness",
        error: err,
      });
      return;
    }
  }

  try {
    const formattedUsers = [];
    const invalidUsers = [];

    const users = groupData.members;
    for (const user of users) {
      const formattedUser = formatUser(user);
      if (validateUser(user)) {
        formattedUsers.push(formattedUser);
      } else {
        invalidUsers.push(user);
      }
    }

    console.log("formattedUsers", formattedUsers);

    groupData.members = formattedUsers;

    if (invalidUsers.length > 0) {
      res.status(400).json({
        code: 400,
        success: false,
        message: "Validation failed for some users",
        invalidUsers: invalidUsers,
      });
      return;
    }

    // Validate and format the group owner
    const formattedGroupOwner = formatUser(groupOwner);
    if (!validateUser(groupOwner)) {
      res.status(400).json({
        code: 400,
        success: false,
        message: "Validation failed for the group owner",
        invalidUser: groupOwner,
      });
      return;
    }

    const group = new Group(groupData);
    group.groupOwner = formattedGroupOwner; // Set the formatted group owner

    await group.save();

    // Update users with group information
    // Update users with group information
    for (const user of formattedUsers) {
      if (user !== formattedGroupOwner) {
        let existingUser = await User.findOne({ username: user });
        if (!existingUser) {
          existingUser = new User({ username: user, groups: [] });
        }
        existingUser.groups.push({
          group_id: group._id,
          shortcode: group.shortcode,
          dateAdded: new Date(),
        });
        await existingUser.save();

        // Send welcome SMS to each user
        const welcomeMessage = `Welcome to '${groupData.groupName}'! The group owner, ${formattedGroupOwner}, has created this group chat. You can use this room to talk in groups just using SMS.`;
        const submitSm = {
          source_addr: shortcode,
          destination_addr: user,
          short_message: welcomeMessage,
        };
        session.submit_sm(submitSm, (err) => {
          if (err) {
            console.error(err);
          }
        });
      }
    }

    // Send separate message to group owner or admin
    const adminMessage = `You have successfully created the group '${groupData.groupName}'! This room has ${formattedUsers.length} members (excluding you).`;
    const submitSm = {
      source_addr: shortcode,
      destination_addr: formattedGroupOwner,
      short_message: adminMessage,
    };
    session.submit_sm(submitSm, (err) => {
      if (err) {
        console.error(err);
      }
    });

    res.status(201).json({
      code: 201,
      success: true,
      message: "Group created successfully",
      shortcode: shortcode,
      total_Members: formattedUsers.length,
      data: group,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      code: 500,
      success: false,
      message: "Error inserting group data to MongoDB",
      error: err,
    });
  }
});

// Add User to Group endpoint
app.post("/groups/users/add", async (req, res) => {
  const shortcode = req.body.shortcode;
  const user = req.body.user;

  try {
    const group = await Group.findOne({ shortcode });
    if (!group) {
      res.status(404).json({
        code: 404,
        success: false,
        message: "Group not found",
      });
      return;
    }

    // Validate the user value
    const isValidUser = validateUser(user);
    if (!isValidUser) {
      res.status(400).json({
        code: 400,
        success: false,
        message: "Invalid user value",
      });
      return;
    }

    // Format the user value to 2517xxxxxxxx
    const formattedUser = formatUser(user);

    // Check if the user already exists
    let existingUser = await User.findOne({ username: formattedUser });
    if (!existingUser) {
      existingUser = new User({ username: formattedUser, groups: [] });
    }

    const { chatHistory, ...groupWithoutChatHistory } = group.toObject();

    const { groupOwner } = group.toObject();

    // Check if the user is already part of the group
    const existingGroup = existingUser.groups.find(
      (group) => group.shortcode === shortcode
    );
    if (existingGroup) {
      res.status(400).json({
        code: 400,
        success: false,
        message: "User is already part of the group",
        shortcode: shortcode,
        groupOwner: groupOwner,
        totalUsers: group.members.length,
        group: groupWithoutChatHistory,
      });
      return;
    }

    // Add group information to the user's details
    existingUser.groups.push({
      group_id: group._id,
      shortcode: shortcode,
      dateAdded: new Date(),
    });
    await existingUser.save();

    // Add user to the group
    group.members.push(formattedUser);
    await group.save();

    // Send SMS notifications
    const otherMembers = group.members.filter(
      (member) => member !== formattedUser
    );

    const notificationMsg = `${formattedUser} has been added to this group chat "${group.groupName}" -> ( ${shortcode} ) `;
    const welcomeMsg = `Welcome to "${group.groupName}" group chat! We are glad to have you on board.\n Type /help to learn more.`;

    // Send notification to other group members
    for (const member of otherMembers) {
      const submitSm = {
        source_addr: shortcode,
        destination_addr: member,
        short_message: notificationMsg,
      };
      session.submit_sm(submitSm, (err) => {
        if (err) {
          console.error(err);
        }
      });
    }

    // Send welcome message to the newly added user
    const submitSm = {
      source_addr: shortcode,
      destination_addr: formattedUser,
      short_message: welcomeMsg,
    };
    session.submit_sm(submitSm, (err) => {
      if (err) {
        console.error(err);
      }
    });

    // Remove chatHistory property from the group object
    //   const { chatHistory, ...groupWithoutChatHistory } = group.toObject();

    res.status(200).json({
      code: 200,
      success: true,
      message: "User added successfully",
      shortcode: shortcode,
      groupOwner: groupOwner,
      totalUsers: group.members.length,
      group: groupWithoutChatHistory,
    });
    // });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      code: 500,
      success: false,
      message: "Error updating group data in MongoDB",
      error: err,
    });
  }
});


// Remove User from Group endpoint
app.delete("/groups/users/delete", async (req, res) => {
  const shortcode = req.body.shortcode;
  let user = req.body.msisdn;

  // Validate and format the user
  user = formatUser(user);
  if (!validateUser(user)) {
    res
      .status(400)
      .json({ code: 400, success: false, message: "Invalid user" });
    return;
  }

  try {
    // Find the group
    const group = await Group.findOne({ shortcode });
    if (!group) {
      res
        .status(404)
        .json({ code: 404, success: false, message: "Group not found" });
      return;
    }

    // Check if the user is the group owner
    if (group.groupOwner === user) {
      res
        .status(400)
        .json({
          code: 400,
          success: false,
          message: "Cannot remove group owner from the group",
        });
      return;
    }

    // Check if the user is a member of the group
    if (!group.members.includes(user)) {
      res
        .status(404)
        .json({
          code: 404,
          success: false,
          message: "User not found in the group",
        });
      return;
    }

    // Remove the user from the group
    const groupUpdateResult = await Group.updateOne(
      { shortcode },
      { $pull: { members: user } }
    );
    if (groupUpdateResult.nModified === 0) {
      res
        .status(404)
        .json({
          code: 404,
          success: false,
          message: "User not found in the group",
        });
      return;
    }

    // Remove the group from the user's collection
    const userUpdateResult = await User.updateOne(
      { username: user },
      { $pull: { groups: { shortcode } } }
    );
    if (userUpdateResult.nModified === 0) {
      res
        .status(404)
        .json({ code: 404, success: false, message: "User not found" });
      return;
    }

    // Get the updated group after removing the user
    const updatedGroup = await Group.findOne({ shortcode });

    // Construct the updated response body
    const responseBody = {
      code: 200,
      success: true,
      message: "User removed successfully",
      shortcode: shortcode,
      totalUsers: updatedGroup.members.length,
      group: updatedGroup,
    };

    res.status(200).json(responseBody);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      code: 500,
      success: false,
      message: "Error updating group data in MongoDB",
      error: err,
    });
  }
});



// Get User Groups endpoint
app.post("/users/list-groups", async (req, res) => {
  let username = req.body.msisdn;

  // Validate and format the username
  username = formatUser(username);
  if (!validateUser(username)) {
    res
      .status(400)
      .json({ code: 400, success: false, message: "Invalid username" });
    return;
  }

  try {
    const users = await User.find({ username }).populate("groups.group_id");
    if (users.length === 0) {
      res.status(404).json({
        code: 404,
        success: false,
        message: "No users found for the provided MSISDN",
      });
      return;
    }

    var count = 0;
    const userGroups = [];
    for (const user of users) {
      const groups = user.groups.map((group) => ({
        groupName: group.group_id.groupName,
        shortcode: group.shortcode,
      }));
      userGroups.push({ MSISDN: user.username, groups });

      count = groups.length;
    }

    res.status(200).json({
      code: 200,
      success: true,
      message: "User groups retrieved successfully",
      // username: username,
      totalGroups: count,
      data: userGroups,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      code: 500,
      success: false,
      message: "Error retrieving user groups from MongoDB",
      error: err,
    });
  }
});

// List Groups without Members endpoint
app.get("/groups/list-all-groups", async (req, res) => {
  try {
    const groups = await Group.find({});

    const groupList = groups.map((group) => ({
      groupName: group.groupName,
      shortcode: group.shortcode,
      totalMembers: group.members.length,
    }));

    res.status(200).json({
      code: 200,
      success: true,
      message: "All Groups retrieved successfully",
      totalGroups: groupList.length,
      groups: groupList,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      code: 500,
      success: false,
      message: "Error retrieving groups without members from MongoDB",
      error: err,
    });
  }
});

// List Members of a Group endpoint
app.get("/groups/list/:shortcode/members", async (req, res) => {
  const shortcode = req.params.shortcode;

  try {
    const group = await Group.findOne({ shortcode });
    if (!group) {
      res.status(404).json({
        code: 404,
        success: false,
        message: "Group not found",
      });
      return;
    }

    res.status(200).json({
      code: 200,
      success: true,
      message: "Members of the group retrieved successfully",
      totalMembers: group.members.length,
      members: group.members,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      code: 500,
      success: false,
      message: "Error retrieving group members from MongoDB",
      error: err,
    });
  }
});

// Define an endpoint to show the chat history for a group
app.get('/groups/:shortcode/chat-history', async (req, res) => {
    try {
      const shortcode = req.params.shortcode;
  
      // Find the group by the shortcode
      const group = await Group.findOne({ shortcode });
      if (!group) {
        return res.status(404).json({ code: 404, success: false, message: 'Group not found' });
      }
  
      const chatHistory = group.chatHistory;
      const total_members = group.members.length;
      const message_Count = chatHistory.length;
  
      // Return the chat history for the group
      res.json({
        code: 200,
        success: true,
        message: 'Chat history fetched successfully',
        shortcode,
        total_members,
        message_Count,
        chatHistory,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ code: 500, success: false, message: 'Internal server error' });
    }
  });

// Function to handle listing group members
async function listGroupMembers(destinationAddr, sourceAddr) {
  try {
    // Find the group with the shortcode matching the destination address
    const group = await Group.findOne({ shortcode: destinationAddr });
    if (!group) {
      console.log("Group not found for shortcode:", destinationAddr);
      return;
    }

    const users = group.members;

    // Construct the list of group members
    let memberList = "Group Members:\n";
    for (const user of users) {
      memberList += `- ${user}\n`;
    }

    // Send the member list via SMS to the source address
    const submitSm = {
      source_addr: destinationAddr,
      destination_addr: sourceAddr,
      short_message: memberList,
    };
    session.submit_sm(submitSm, (err) => {
      if (err) {
        console.error(err);
      }
    });

    console.log("Group members list sent successfully.");
  } catch (err) {
    console.error("Error listing group members:", err);
  }
}

// Function to handle showing the group owner
async function showGroupOwner(destinationAddr, sourceAddr) {
  try {
    // Find the group with the shortcode matching the destination address
    const group = await Group.findOne({ shortcode: destinationAddr });
    if (!group) {
      console.log("Group not found for shortcode:", destinationAddr);
      return;
    }

    // Get the group owner
    const groupOwner = group.groupOwner;

    // Send the group owner via SMS to the source address
    const submitSm = {
      source_addr: destinationAddr,
      destination_addr: sourceAddr,
      short_message: `Group Owner: ${groupOwner}`,
    };
    session.submit_sm(submitSm, (err) => {
      if (err) {
        console.error(err);
      }
    });

    console.log("Group owner sent successfully.");
  } catch (err) {
    console.error("Error showing group owner:", err);
  }
}

// Function to handle displaying group information
async function displayGroupInfo(destinationAddr, sourceAddr) {
  try {
    // Find the group with the shortcode matching the destination address
    const group = await Group.findOne({ shortcode: destinationAddr });
    if (!group) {
      console.log("Group not found for shortcode:", destinationAddr);
      return;
    }

    const users = group.members;
    const groupName = group.groupName;
    const totalMembers = users.length;

    // Construct the group information message
    const groupInfo = `Group Name: ${groupName}\nShortcode: ${destinationAddr}\nTotal Members: ${totalMembers}`;

    // Send the group information via SMS to the source address
    const submitSm = {
      source_addr: destinationAddr,
      destination_addr: sourceAddr,
      short_message: groupInfo,
    };
    session.submit_sm(submitSm, (err) => {
      if (err) {
        console.error(err);
      }
    });

    console.log("Group information sent successfully.");
  } catch (err) {
    console.error("Error displaying group information:", err);
  }
}

async function displayHelpMenu(destinationAddr, sourceAddr) {
  try {
    const helpMenu = [
      "\n Commands and Their Uses \n",
      "/list-group-members -> To list all group members",
      "/show-group-owner -> To show the group owner",
      "/group-info -> To display group information",
      "/help -> Shows this help menu",
      "/leave-group-chat -> To leave this group chat",
    ];

    // Check if destinationAddr and sourceAddr are defined
    if (!destinationAddr || !sourceAddr) {
      throw new Error("Invalid destination or source address");
    }

    // Check if helpMenu is defined and has elements
    if (!helpMenu || helpMenu.length === 0) {
      throw new Error("Help menu is empty");
    }

    // Construct the help menu message
    const helpMenuMessage = helpMenu.join("\n");

    // Send the help menu via SMS to the source address
    const submitSm = {
      source_addr: destinationAddr,
      destination_addr: sourceAddr,
      short_message: helpMenuMessage,
    };
    session.submit_sm(submitSm, (err) => {
      if (err) {
        console.error(err);
      }
    });

    console.log("Help menu sent successfully.");
  } catch (err) {
    console.error("Error displaying help menu:", err);
  }
}

// Function to validate and process the received message
async function processReceivedMessage(pdu) {
  const messageContent = pdu.short_message.message;

  // Check if the sender is part of the group
  const group = await Group.findOne({ shortcode: pdu.destination_addr });
  if (!group) {
    console.log("Group not found for shortcode:", pdu.destination_addr);
    return;
  }

  const users = group.members;

  if (!users.includes(pdu.source_addr)) {
    console.log("Sender not in the group:", pdu.source_addr);
    // Send an SMS back to the source address indicating they are not part of the group
    const submitSm = {
      source_addr: pdu.destination_addr,
      destination_addr: pdu.source_addr,
      short_message:
        "Sorry, you are not currently a member of this group chat.",
    };
    session.submit_sm(submitSm, (err) => {
      if (err) {
        console.error(err);
      }
    });
    return;
  }

  // Check for special commands in the message content
  if (messageContent === "/list-group-members") {
    // Call a function to handle listing group members
    await listGroupMembers(pdu.destination_addr, pdu.source_addr);
    return;
  } else if (messageContent === "/show-group-owner") {
    // Call a function to handle showing the group owner
    await showGroupOwner(pdu.destination_addr, pdu.source_addr);
    return;
  } else if (messageContent === "/group-info") {
    // Call a function to handle displaying group information
    await displayGroupInfo(pdu.destination_addr, pdu.source_addr);
    return;
  } else if (messageContent === "/help") {
    // Call a function to handle displaying group information
    await displayHelpMenu(pdu.destination_addr, pdu.source_addr);
    return;
  }

  try {
    // Send SMS messages to all users except the sender
    for (const user of users) {
      if (user === pdu.source_addr) {
        continue;
      }
      const submitSm = {
        source_addr: pdu.destination_addr,
        destination_addr: user,
        short_message: `From ${pdu.source_addr}: \n ${messageContent}`,
      };
      session.submit_sm(submitSm, (err) => {
        if (err) {
          console.error(err);
        }
      });
    }

    // Add message to chat history for the group
    const message = {
      timestamp: new Date(),
      sourceAddr: pdu.source_addr,
      message: messageContent,
    };
    group.chatHistory.push(message);
    await group.save();

    console.log("SMS messages sent successfully.");

    // Construct the updated response body
    const responseBody = {
      code: 200,
      success: true,
      message: "SMS messages sent successfully",
      shortcode: pdu.destination_addr,
      totalUsers: users.length,
      group: group,
      chatHistory: group.chatHistory,
    };

    console.log("Response:", responseBody);
  } catch (err) {
    console.error("Error sending SMS:", err);
  }
}

// Event handler for "deliver_sm"
session.on("deliver_sm", async (pdu) => {
  console.log(
    "Received SMS from:",
    pdu.source_addr,
    "to:",
    pdu.destination_addr
  );
  console.log("Message:", pdu.short_message.message);
  if (pdu.receipted_message_id && pdu.receipted_message_id.delivered) {
    console.log("Received at:", pdu.receipted_message_id.delivered);
  }
  console.log("----------------------------------------------");

  // Call the separate function to process the received message
  await processReceivedMessage(pdu);
});

// Function to validate the user value
function validateUser(user) {
  const regex = /^(07\d{8}|2517\d{8}|\+2517\d{8}|7\d{8})$/;
  return regex.test(user);
}

// Function to format the user value to 2517xxxxxxxx
function formatUser(user) {
  const regex = /^(07\d{8}|2517\d{8}|\+2517\d{8}|7\d{8})$/;
  const match = regex.exec(user);
  if (match) {
    const phoneNumber = match[0].replace(/\D/g, ""); // Remove non-digit characters
    if (phoneNumber.startsWith("07")) {
      return `2517${phoneNumber.slice(2)}`;
    } else if (phoneNumber.startsWith("7")) {
      return `2517${phoneNumber.slice(1)}`;
    } else if (phoneNumber.startsWith("2517")) {
      return phoneNumber;
    } else if (phoneNumber.startsWith("+2517")) {
      return phoneNumber.slice(1);
    }
  }
  return user;
}

function generateShortcode(groupName) {
  let isUnique = false;
  let shortcode = "";

  //   while (!isUnique) {
  // Generate a random shortcode
  shortcode = generateRandomShortcode();

  // Check if the shortcode is unique
  //   const existingGroup = Group.findOne({ shortcode });
  //   if (!existingGroup) {
  // isUnique = true;
  //   }
  //   }

  return shortcode;
}

function generateRandomShortcode() {
  // Generate a random shortcode with 7 digits starting with 0
  const characters = "0123456789";
  let shortcode = "0";
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    shortcode += characters.charAt(randomIndex);
  }
  return shortcode;
}

function generateRandomShortcodeWithLetters() {
  // Generate a random shortcode using alphanumeric characters
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let shortcode = "";
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    shortcode += characters.charAt(randomIndex);
  }
  return shortcode;
}

app.listen(3000, () => {
  console.log("Group chat API is listening on port 3000.");
});
