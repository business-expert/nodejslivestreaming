Development Server:
IP 104.131.177.49
user: root
password eosforos77

local database: rmss_appliance
user: root
password: password123


Project tree

/home
     /assets
          Folder contains media clips that serve as preroles/postroles in the playback queue
     /buffer
          /2016_11_02_22_43_08
              Session folder contains fragments and playlist for hls stream
     /domsocks
          contains Unix domain socket used to facilitate communication between app server
          and download deamon process
     /noderoot  Contains all nodejs modules
           /node_modules
                 Contains all the node js modules used by the app. Our own homebrewed
                 modules are in the /sfj folder
           /static
                /css  all style related GUI resources go here
                /js   all javascript related GUI resources go here
                /views  all html related GUI resources go here
                       currently this folder contains a number of test/experimental pages 
                       that demonstrate the interaction between GUI and app server. The /tests
                       folder contains some minimalistic implementations of app server calls
                       

The app server calls are documented in /home/noderoot/endpoints.txt For the application to work, obviously, the app server and the loader deamon must be running.

Call 
>forever list

to make sure that main.js (the app server) and sockserver.js (the loader deamon) are up and running. To stop them use 

>forever stop [int]

where [int] is the process number returned by forever list. To start them use

>forever start main.js     (for the app server)
>forever start sockserver.js    (for the loader deamon)

Restarting the loader deamon does sometimes result in an error if the restart comes imediately after a stop and the Unix domsocket is still blocked. In this case you wait for a few seconds before trying to restart.

There is a standalone script sockcon.js which lets you send commands to the loader deamon for debug and test purposes. 

For the client side the relevant code modules are those in the /home/noderoot/static/views folder. The one named queueing.html has much of the functionality implemented. Although only on a rough pre-prototype quality. More examples for the use of the app server are coded in the tests folder.

The deliverable application (js, css, html, gfx) should be in the /home/noderoot/static folder. Use the /views folder for all html modules, /js folder for all script components and
/css folder for all style components. 
