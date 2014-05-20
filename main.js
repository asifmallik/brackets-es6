define(function (require, exports, module) {
    "use strict";

    /** --- MODULES --- **/
    var CommandManager = brackets.getModule("command/CommandManager"),
        Menus = brackets.getModule("command/Menus"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        EditorManager = brackets.getModule("editor/EditorManager"),
        ExtensionUtils = brackets.getModule("utils/ExtensionUtils"),
        NodeConnection = brackets.getModule("utils/NodeConnection"),
        Dialogs = brackets.getModule("widgets/Dialogs"),
		FileSystem = brackets.getModule("filesystem/FileSystem"),
        ansi = require("ansi"),
        nodeConnection = new NodeConnection(),
        ES6MenuID = "es6-menu",
        ES6Menu = Menus.addMenu("ECMAScript 6", ES6MenuID),
        source = null,
        ES6_COMPILE_DIALOG_ID = "es6-compile-dialog",
        LS_PREFIX = "es6-",
        API_VERSION = 1;


    /**
     * Shortcuts for localstorage with prefix
     */
    function get(name) {
        return localStorage.getItem(LS_PREFIX + name);
    }

    function set(name, value) {
        return localStorage.setItem(LS_PREFIX + name, value);
    }

    function rm(name) {
        return localStorage.removeItem(LS_PREFIX + name);
    }
    /**
     * Load the configuration
     */
    var config = JSON.parse(require("text!config.json"));

    /**
     * Start the node server
     */
    nodeConnection.connect(true).then(function () {
        nodeConnection.loadDomains(
            [ExtensionUtils.getModulePath(module, "server.js")],
            true
        ).then(
            function () {
                console.log("[brackets-es6] Connected to nodejs");
            }
        ).fail(
            function () {
                console.log("[brackets-es6] Failed to connect to nodejs. The server may be up because of another instance");
            }
        );
    });

    /**
     * The ConnectionManager helps to build and run request to execute a file on the serverside
     */
    var ConnectionManager = {
        
        last: {
            command: null,
            cwd: null
        },
        
        /**
         * Creates a new EventSource
         *
         * @param (optional): Command name
         * @param (optional): Execute in the current working directory
         * @param (optional): Directory to use as cwd
         */
        // This need to be inside quotes since new is a reserved word
        "new": function (command, useCurrentCwd, cwd) {

            if (source && source.close) source.close();
            
            // Current document
            var doc = DocumentManager.getCurrentDocument();
            if(!doc.file.isFile) return;
            
            // Build url
            var url = "http://" + config.host + ":" + config.port + "/?command=" + encodeURIComponent(command);
            var dir = null;
            if(useCurrentCwd) {
                dir = doc.file.parentPath;
            } else if(cwd) {
                dir = cwd;
            }
            
            if(dir !== null) {
                url += "&cwd=" + encodeURIComponent(dir);
            }

            // Add api version
            url += "&apiversion=" + API_VERSION;

            // Store the last command and cwd
            this.last.command = command;
            this.last.cwd = dir;
            
            // Server should be running
            source = new EventSource(url);

            source.addEventListener("message", function (msg) {
                Panel.write(msg.data);
            }, false);
            source.addEventListener("error", function () {
                source.close();
                Panel.write("Program exited.");
            }, false);
            
            Panel.show(command);
            Panel.clear();
        },
        
        newTraceur: function () {
            // Current document
            var doc = DocumentManager.getCurrentDocument();
            if(!doc.file.isFile) return;
            
            this.new('traceur --experimental "' + doc.file.fullPath + '"', true);
            
        },
        
        rerun: function () {
            
            var last = this.last;
            if(last.command === null) return;
            
            this.new(last.command, false, last.cwd);
            
        },
		
		newTraceurCompile: function(compiledPath){
			// Current document
            var doc = DocumentManager.getCurrentDocument();
            if(!doc.file.isFile) return;
			this.new('traceur --experimental --dir "' + doc.file.fullPath + '" ' + '"' + compiledPath + '"', true);
		},

        /**
         * Close the current connection if server is started
         */
        exit: function () {
            source.close();
        }
    };

    /**
     * Panel alias terminal
     */
    $(".content").append(require("text!html/panel.html"));
    var Panel = {

        id: "brackets-es6-terminal",
        panel: null,
        commandTitle: null,
        height: 201,

        get: function (qs) {
            return this.panel.querySelector(qs);
        },

        /**
         * Basic functionality
         */
        show: function (command) {
            this.panel.style.display = "block";
            this.commandTitle.textContent = command;
            EditorManager.resizeEditor();
        },
        hide: function () {
            this.panel.style.display = "none";
            EditorManager.resizeEditor();
        },
        clear: function () {
            this.pre.innerHTML = null;
        },

        /**
         * Prints a string into the terminal
         * It will be colored and then escape to prohibit XSS (Yes, inside an editor!)
         *
         * @param: String to be output
         */
        write: function (str) {
            var e = document.createElement("div");
            e.innerHTML = ansi(str.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
            this.pre.appendChild(e);
        },

        /**
         * Used to enable resizing the panel
         */
        mousemove: function (e) {

            var h = Panel.height + (Panel.y - e.pageY);
            Panel.panel.style.height = h + "px";
            EditorManager.resizeEditor();

        },
        mouseup: function (e) {

            document.removeEventListener("mousemove", Panel.mousemove);
            document.removeEventListener("mouseup", Panel.mouseup);

            Panel.height = Panel.height + (Panel.y - e.pageY);

        },
        y: 0
    };

    // Still resizing
    Panel.panel = document.getElementById(Panel.id);
    Panel.commandTitle = Panel.get(".cmd");
    Panel.pre = Panel.get(".table-container pre");
    Panel.get(".resize").addEventListener("mousedown", function (e) {

        Panel.y = e.pageY;

        document.addEventListener("mousemove", Panel.mousemove);
        document.addEventListener("mouseup", Panel.mouseup);

    });

    /**
     * Terminal buttons
     */
    document.querySelector("#" + Panel.id + " .action-close").addEventListener("click", function () {
        ConnectionManager.exit();
        Panel.hide();
    });
    document.querySelector("#" + Panel.id + " .action-terminate").addEventListener("click", function () {
        ConnectionManager.exit();
    });
    document.querySelector("#" + Panel.id + " .action-rerun").addEventListener("click", function () {
        ConnectionManager.rerun();
    });

        var compileDialog =  {

            /**
             * HTML put inside the dialog
             */
            html: require("text!html/modal-compile.html"),

            /**
             * Opens up the modal
             */
            show: function () {
				var doc = DocumentManager.getCurrentDocument();
            	if(!doc.file.isFile) return;
				var defualtFileName =  "compiled-es5-" + doc.file.name,
					newFilePath, filePath = doc.file.parentPath + defualtFileName;
                Dialogs.showModalDialog(
                    ES6_COMPILE_DIALOG_ID,
                    "Compile ES6 code to ES5 code",
                    this.html, [{
                        className: Dialogs.DIALOG_BTN_CLASS_PRIMARY,
                        id: Dialogs.DIALOG_BTN_OK,
                        text: "Compile"
                    }, {
                        className: Dialogs.DIALOG_BTN_CLASS_NORMAL,
                        id: Dialogs.DIALOG_BTN_CANCEL,
                        text: "Cancel"
                    }]
                ).done(function (id) {

                    if (id !== "ok") return;
					
                    ConnectionManager.newTraceurCompile(filePath);

                });

                // It's important to get the elements after the modal is rendered but before the done event
                var filePathView = document.querySelector("." + ES6_COMPILE_DIALOG_ID + " .file-path"),
                 changeFilePathBtn= document.querySelector("." + ES6_COMPILE_DIALOG_ID + " .change-file-path");
				filePathView.innerHTML = filePath;
				changeFilePathBtn.addEventListener("click", function(){
					FileSystem.showSaveDialog("Compile ES6 code  to", doc.file.parentPath, defualtFileName, function(a, dir){
						filePath = dir;
						filePathView.innerHTML = filePath;
					});
				}, false);
            }
        };

    /**
     * Menu
     */
    var RUN_CMD_ID = "brackets-es6.run",
        COMPILE_CMD_ID = "brackets-es6.compile";
    
	CommandManager.register("Run", RUN_CMD_ID, function () {
        ConnectionManager.newTraceur();
    });
    CommandManager.register("Compile to ES5", COMPILE_CMD_ID, function() {
        compileDialog.show();
    });

    ES6Menu.addMenuItem(RUN_CMD_ID);
    ES6Menu.addMenuItem(COMPILE_CMD_ID);
});
