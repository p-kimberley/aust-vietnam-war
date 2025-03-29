
BM.IncidentNote = (function() {
	var _scope = null;
	var _currentNoteID = null;
	var _noteIncidentID = null;
	var _dialog = $('#incident-note-fullscreen-window-container');
	var _noteContainer = $('#incident-note-container');
	var _noteContentContainer = $('#incident-note-content-container');

	BM.angularApp.controller('incidentNoteController', ['$scope', '$http', '$log', '$timeout', 'BM.services.utility', 'BM.services.incidentNote',
		function($scope, $http, $log, $timeout, utilityServices, incidentNoteServices)
		{
			_scope = $scope;
			$scope.utilityServices = utilityServices;
			$scope.incidentNoteServices = incidentNoteServices;

			/**
			 * Retrieves an existing note
			 * @param {number} noteID
			 */
			$scope.getNote = function (noteID)
			{
				DisplayLoadingIndicator(_noteContentContainer.find('.mCustomScrollBox'), 'Loading incident note...');
				$http.get('/api/es/search/avw_incident_notes/incident_note/' + noteID).then(function (response)
				{
					HideLoadingIndicator(_noteContentContainer.find('.mCustomScrollBox'));
					$scope.noteId = response.data._id;
					$scope.noteData = response.data._source;
					$scope.noteComments = $scope.noteData.Comments.filter(function(comment) { return comment.ID !== undefined; });
					_currentNoteID = noteID;
					_noteIncidentID = $scope.noteData.Incident_ID;

					$http({
						method: 'GET',
						url: '/src/php/bm/get-user-meta.php?' + $.param({
							userIDArray: $scope.noteData.Author.ID,
							avatarSize: 60
						})
					}).then(function (response) {
						$scope.userMeta = response.data[0];
					}, function (error)
					{
						InfoDialog('Error', 'Author information for incident note ' + noteID + ' could not be loaded.<br><br>' +
							'Your Internet connection may have been interrupted or the note may no longer exist.');
						$log.error(error);
						BM.IncidentNote.close();
					});

					$scope.getNoteApprovalStatus();
					$scope.getNoteComments();

					// Resize the note container to fit content to the container
					$timeout(function() {
						$(window).trigger('resize');
					});

				}, function (error)
				{
					InfoDialog('Error', 'The requested incident note ' + noteID + ' could not be loaded.<br><br>' +
						'Your Internet connection may have been interrupted or the note may no longer exist.');
					$log.error(error);
					BM.IncidentNote.close();
				});
			};

			/**
			 * Attaches a new note to the incident
			 * @param {number} incidentID
			 * @param {string} noteTitle
			 * @param {string} noteBody
			 */
			$scope.addNote = function (incidentID, noteTitle, noteBody)
			{
				$http.post('/src/php/bm/add-incident-note.php', {
					incidentID: incidentID,
					noteTitle: encodeURIComponent(noteTitle),
					noteBody: encodeURIComponent(noteBody)
				}).then(function (response)
				{
					try
					{
						var newNoteID = parseInt(response.data);
						_displayNote(newNoteID);
						BM.MarkerPanel.refreshNoteList();
						BM.NotePanel.refreshNoteLists();

						var approvalQueueMessage = "";
						var msg;

						// Add a message about the approval process
						if (!(BM.currentWPUser.editor || BM.currentWPUser.administrator))
						{
							approvalQueueMessage = 'Thankyou for your contribution. Your note has been placed in an approval queue where it awaits moderation by our team. ' +
								'During this time, it will not be visible to the general public. If approved, it will be automatically published to the site.<br/><br/>';
						}
						else
						{
							approvalQueueMessage = 'Due to your user level, your note has been published without requiring moderation.<br/><br/>';
						}

						msg = 'Your incident note has been successfully submitted.<br/><br/>' + approvalQueueMessage +
							'To find or edit it in the future, open the <em>Community Notes</em> panel and find the section titled <em>My Notes</em>.';

						InfoDialog('Incident Note Submitted', msg);
					}
					catch (ex)
					{
						InfoDialog('New Incident Note', 'An error occurred when opening the new incident note.<br/><br/>An invalid note ID was returned: ' + response.data + '<br/><br/>' +
							'Your note was not successfully created - please try submitting it again.');
					}
				}, function (error)
				{
					InfoDialog("Add Note", "A note could not be added for incident " + incidentID + ".<br/><br/>Please check your Internet connection and try again.");
					$log.error(error);
				});
			};

			/**
			 * @param {number} noteID
			 * @param {string} noteTitle
			 * @param {string} noteBody
			 */
			$scope.updateNote = function (noteID, noteTitle, noteBody)
			{
				$http.post('/src/php/bm/update-incident-note.php', {
					noteID: noteID,
					noteTitle: encodeURIComponent(noteTitle),
					noteBody: encodeURIComponent(noteBody)
				}).then(function (response)
				{
					$scope.getNote(noteID);
					BM.MarkerPanel.refreshNoteList();
					BM.NotePanel.refreshNoteLists();
				}, function (error)
				{
					InfoDialog("Update Note", "Note " + noteID + " could not be updated and may have been deleted.");
					$log.error(error);
				});
			};

			/**
			 * @param {number} noteID
			 */
			$scope.deleteNote = function (noteID)
			{
				// Delete the note after re-authenticating against the user's roles
				$http.post('/src/php/bm/delete-incident-note.php', {
					noteID: noteID
				}).then(function (response)
				{
					_currentNoteID = null;
					_noteIncidentID = null;
					_close();
				}, function (error)
				{
					InfoDialog("Delete Note", "The note could not be deleted.<br><br>You may not be authorised to perform this action.");
				});
			};

			/**
			 * Sets display classes and elements based on the approval status. Used to init approval buttons and status display.
			 */
			$scope.getNoteApprovalStatus = function ()
			{
				var statusTip = "";
				switch ($scope.noteData.Approval_Status)
				{
					case -1:
						$scope.moderationStatusClass = "pending";
						$scope.moderationStatusText = "Pending moderation";
						statusTip =
							"<p class='incident-note-moderation-status-tip'>This incident note is awaiting review by the site moderation team.<br /><br />" +
							"It is only visible to the original author and site administrators.<br /><br />" +
							"<em>As per the site Terms of Use, all user-contributed content must be first approved by site moderators before being published.</em></p>";
						break;
					case 0:
						$scope.moderationStatusClass = "rejected";
						$scope.moderationStatusText = "Rejected by moderators";
						statusTip =
							"<p class='incident-note-moderation-status-tip'>This incident note was rejected by moderators on " +
							moment($scope.noteData.Approval_Status_Changed).format('DD/MM/YYYY') + " due to its content.<br /><br />" +
							"It will remain visible only to the original author and site administrators. " +
							"If you wish to dispute this decision, please contact the site team.<br /><br />" +
							"<em>As per the site Terms of Use, all user-contributed content must be first approved by site moderators before being published.</em></p>";
						break;
					case 1:
						$scope.moderationStatusClass = "approved";
						$scope.moderationStatusText = "Approved and published";
						statusTip =
							"<p class='incident-note-moderation-status-tip'>This incident note was approved by the site moderation team on " +
							moment($scope.noteData.Approval_Status_Changed).format('DD/MM/YYYY') + " and is visible to all site visitors.<br /><br />" +
							"Future changes to this note will require moderation approval.<br /><br />" +
							"<em>As per the site Terms of Use, all user-contributed content must be first approved by site moderators before being published.</em></p>";
						break;
				}

				_dialog.find('.moderation-status').tooltipster('content', $(statusTip));
			};

			/**
			 * Sets the approval status of the current incident note
			 * @param {number} newStatus - Status to set the note to. -1: Pending; 0: Rejected; 1: Approved
			 */
			$scope.setNoteApprovalStatus = function (newStatus)
			{
				var statusSpinner = _noteContainer.find('.status-spinner');

				DisplayTinyLoadingIndicator(statusSpinner);
				$http.post('/src/php/bm/update-incident-note-approval-status.php', {
					noteID: _currentNoteID,
					approvalStatus: newStatus
				}).then(function ()
				{
					HideTinyLoadingIndicator(statusSpinner);
					$scope.noteData.Approval_Status = newStatus;
					$scope.getNoteApprovalStatus();
				}, function (error)
				{
					InfoDialog('Note Approval', 'The approval status of note ' + _currentNoteID + ' could not be changed. You may not have permission.');
					$log.error(error);
				});
			};

			$scope.formatDate = function (date)
			{
				return moment(date).calendar();
			};

			$scope.userHasNoteEditPermission = function ()
			{
				if ($scope.noteData && $scope.noteData.Author)
					return utilityServices.isPrivilegedUser() || (BM.currentWPUser.ID === $scope.noteData.Author.ID && BM.currentWPUser.ID !== 0);
			};

			$scope.userHasCommentEditPermission = function (authorID)
			{
				return utilityServices.isPrivilegedUser() || (BM.currentWPUser.ID === authorID && authorID !== 0);
			};

			$scope.getNoteComments = function ()
			{
				var authorIDArray = [];

				// Store an aray of all the comment user IDs so the user avatars can be retrieved
				$.each($scope.noteComments, function (i, item) {
					authorIDArray.push(item.Author.ID);
				});

				$http.get('/src/php/bm/get-user-meta.php?' + $.param({
					userIDArray: authorIDArray.toString(),
					avatarSize: 30
				})).then(function (response) {
					$scope.commentAuthorMeta = response.data;
				}, function (error) {
					InfoDialog('Note Comments', 'Note comment user metadata could not be retrieved. Please refresh the page and try again.<br/><br/>Error ' + error.status + " " + error.statusText);
				});
			};

			$scope.getCommentAuthorMeta = function (index)
			{
				if ($scope.commentAuthorMeta)
					return $scope.commentAuthorMeta[index];
			};

			/**
			 * Adds a new comment to the specified note
			 * @param {number} noteID
			 * @param {string} comment
			 */
			$scope.addComment = function (noteID, comment)
			{
				var submitStatus = $('#incident-note-comments-submit-status');
				var showStatusResult = function(statusClass) {
					HideTinyLoadingIndicator(submitStatus);
					submitStatus.find('.status-icon')
						.addClass(statusClass)
						.fadeIn(400);
				};

				submitStatus.find('.status-icon').hide();
				DisplayTinyLoadingIndicator(submitStatus);

				$http.post('/src/php/bm/add-incident-note-comment.php', {
					noteID: noteID,
					comment: encodeURIComponent(comment),
					noteAuthor: $scope.noteData.Author
				}).then(function (response)
				{
					DisplayTinyLoadingIndicator(submitStatus);

					if (response.status === 200)
					{
						showStatusResult('success');

						$scope.getNote(_currentNoteID);
						$scope.comment = "";
						BM.MarkerPanel.refreshNoteList();
						BM.NotePanel.refreshNoteLists();
					}
					else
					{
						showStatusResult('fail');
						InfoDialog('Add Note Comment', 'Your comment for note ' + noteID + ' could not be submitted.');
					}
				}, function (error)
				{
					showStatusResult('fail');
					InfoDialog('Add Note Comment', 'Your comment for note ' + noteID + ' could not be submitted. Please try again.<br/><br/>Error ' + error.status + " " + error.statusText);
					DisplayTinyLoadingIndicator(submitStatus);
				});
			};

			/**
			 * Removes a comment by its ID
			 * @param {number} commentID
			 * @param event
			 */
			$scope.deleteComment = function (commentID, event)
			{
				if (confirm("Delete this comment?"))
				{
					$http.post('/src/php/bm/delete-incident-note-comment.php', {
						commentID: commentID
					}).then(function (response)
					{
						if (response.data == 1)
						{
							if (event)
							{
								var listItem = $(event.target).parents('li');
								listItem.velocity('slideUp', {
									duration: 200, complete: function ()
									{
										$scope.getNote(_currentNoteID);
										BM.MarkerPanel.refreshNoteList();
										BM.NotePanel.refreshNoteLists();
									}
								});
							}
						}
						else
						{
							InfoDialog('Delete Note Comment', 'Comment deletion failed. You do not have permission to delete this comment.');
						}
					}, function (error)
					{
						InfoDialog('Delete Note Comment', 'The note comment could not be deleted.<br/><br/>Error ' + error.status + " " + error.statusText);
					});
				}
			}
		}]);

	function _init()
	{
		// Manually initialise AngularJS since the app instance is encapsulated within this class
		//angular.bootstrap(document.getElementById('incident-note-fullscreen-window-container'), ['incidentNoteApp']);

		_dialog.find('.moderation-panel').children().tooltipster();
		$('#incident-note-controlbox').children().tooltipster({
			theme: ['tooltipster-light', 'battlemap-tooltip-light']
		});
		$('#incident-note-comments, #incident-note-content-container').mCustomScrollbar({
			autoHideScrollbar: false,
			scrollInertia: 200,
			mouseWheel: {
				scrollAmount: 100
			},
			theme: 'dark',
			advanced: {
				updateOnContentResize: true
			}
		});
	}

	/**
	 * Displays an incident note and its comments
	 * @param {number} noteID
	 * @private
	 */
	function _displayNote(noteID)
	{
		if (noteID > 0)
		{
			BM.ActivityLogging.logEvent(BM.LogEventTypes.openedIncidentNote, noteID);

			BM.WindowManager.openMaximised('incident.note');
			_dialog.fadeIn(200);
			_scope.getNote(noteID);
			BM.StateManagement.replaceState();
		}
		else
		{
			console.log('Warning: Invalid note ID: ' + noteID);
		}
	}

	/**
	 * Prompts the user to enter a new note then uploads it
	 * @private
	 */
	function _addNote(incidentID)
	{
		// If the user isn't logged in, redirect to the login page
		if (BM.currentWPUser.ID == 0)
		{
			RedirectToLoginPage();
			return;
		}

		_showEditorDialog('Add incident note', 'Add Note', null, null,
			function (submittedTitle, submittedBody)
			{
				if (submittedTitle.length > 0 && submittedBody.length > 0)
				{
					_scope.addNote(incidentID, submittedTitle, submittedBody);
					return true;
				}
				else
				{
					return false;
				}
			});
	}

	/**
	 * Displays an edit dialog allowing the user to change the note's title and content
	 * @private
	 */
	function _updateNote()
	{
		// If the user isn't logged in, redirect to the login page
		if (BM.currentWPUser.ID == 0)
		{
			RedirectToLoginPage();
			return;
		}

		_showEditorDialog('Edit incident note', 'Save Note', _scope.noteData.Title, _scope.noteData.Body,
			function (submittedTitle, submittedBody)
			{
				if (submittedTitle.length > 0 && submittedBody.length > 0)
				{
					_scope.updateNote(_currentNoteID, submittedTitle, submittedBody);
					return true;
				}
				else
				{
					return false;
				}
			});
	}

	/**
	 * Prompts the user to destroy the note and all comments
	 * @private
	 */
	function _deleteNote()
	{
		// Prompt the user for confirmation
		if (!confirm("Permanently delete the currently open note and all comments?"))
			return;

		_scope.deleteNote(_currentNoteID);
	}

	/**
	 * Displays a modal dialog containing a rich text editor
	 * @param {string} title - Dialog title
	 * @param {string} submitButtonText - Text to use for the submit button
	 * @param {string} [initialTitle] - Value to use for the note title in the dialog
	 * @param {string} [initialBody] - Value to initialise the editor with
	 * @param onSubmit - Method called when the user clicks the submit button. Requires two parameters (title and body text being submitted). Return value determines whether to close the dialog (TRUE) or not (FALSE)
	 * @private
	 */
	function _showEditorDialog(title, submitButtonText, initialTitle, initialBody, onSubmit)
	{
		var dialogNoteInput = $('#dialog-incident-note-input');
		var inputTitle = $('#incident-note-input-title');
		var inputBody = $('#incident-note-input-textarea');
		var dialogPositionContainer = $('#top-container');
		var contentAreaWidth = dialogPositionContainer.width();
		var contentAreaHeight = dialogPositionContainer.height();

		// Set up dialog actions and show the note input dialog
		dialogNoteInput.dialog({
			title: title,
			width: Math.round(contentAreaWidth * 0.9),              // Make the dialog 10% smaller than the window dimensions
			height: Math.round(contentAreaHeight * 0.8),
			minWidth: 400,
			minHeight: 400,
			modal: true,
			zIndex: -1,
			position: {
				my: 'center', at: 'center', of: dialogPositionContainer
			},
			resizable: true,
			autoOpen: true,
			buttons: [{
				text: "Cancel",
				click: function ()
				{
					$(this).dialog('close');
				}
			},{
				text: submitButtonText,
				class: 'default',
				click: function ()
				{
					var noteTitle = inputTitle.val();
					var noteBody = inputBody.val();

					if (onSubmit)
					{
						// Handler method reports the submission was successful, so close the dialog
						if (onSubmit(noteTitle, noteBody))
						{
							inputBody.ckeditor().editor.resetDirty();
							inputTitle.val('');
							$(this).dialog('close');
						}
						else
						{
							if (noteTitle === "")
							{
								InfoDialog("Incomplete Data", "Note title field is required before submitting.", function ()
								{
									inputTitle.focus();
								});
							}
							else if (noteBody === "")
							{
								InfoDialog("Incomplete Data", "Note body field is required before submitting.", function ()
								{
									inputBody.ckeditor().editor.focus();
								});
							}
						}
					}
				}
			}],
			open: function (event, ui)
			{
				dialogNoteInput
					.css('overflow', 'hidden')
					.css('width', 'auto');

				if (initialTitle)
					inputTitle.val(initialTitle);

				if (initialBody)
					inputBody.val(initialBody);
				else
					inputBody.val('');

				inputBody.ckeditor({
					width: 'auto',
					height: 'auto',
					resize_enabled: false,
					on: {
						instanceReady: function (event) {
							_resizeTextArea();
						}
					}
				});

				inputTitle.focus();
			},
			beforeClose: function (event, ui)
			{
				if (inputBody.ckeditor().editor.checkDirty() || inputTitle.val() != "")
					return confirm("Note not saved. Discard changes?");
				else
					return true;
			},
			close: function (event, ui)
			{
				inputTitle.val('');
				inputBody.ckeditor().editor.destroy();
				dialogNoteInput.dialog('destroy');
			},
			resize: function ()
			{
				_resizeTextArea();
			}
		});
	}

	/**
	 * Keeps the note body textarea size in sync with the input dialog
	 * @private
	 */
	function _resizeTextArea()
	{
		var noteInputDialog = $('#dialog-incident-note-input');
		var noteInputEditor = $('#incident-note-input-textarea');
		var inputContainer = $('#incident-note-input-container');

		inputContainer.css('height', noteInputDialog.height() - inputContainer.position().top + 5);
		noteInputEditor.ckeditor().editor.resize(inputContainer.width(), inputContainer.height());
	}

	/**
	 * Opens the associated incident in the panel
	 * @private
	 */
	function _openIncident()
	{
		if (_noteIncidentID && BM.MarkerPanel.getCurrentIncidentID() != _noteIncidentID)
			BM.MarkerPanel.showForIncidentByID(_noteIncidentID);
	}

	/**
	 * Closes the incident note
	 * @private
	 */
	function _close()
	{
		_currentNoteID = null;
		_noteIncidentID = null;
		BM.MarkerPanel.refreshNoteList();
		BM.NotePanel.refreshNoteLists();
		BM.StateManagement.replaceState();
		BM.WindowManager.closeMaximised('incident.note');
		_dialog.fadeOut(200);
	}

	_init();

	return {
		displayNote: _displayNote,
		addNote: _addNote,
		updateNote: _updateNote,
		deleteNote: _deleteNote,
		openIncident: _openIncident,
		getCurrentNoteID: function() { return _currentNoteID; },
		close: _close
	};
})();