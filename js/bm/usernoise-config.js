
var usernoise = {
	"config": {
		"loggedIn": false,
		"button": {
			"enabled": false,
			"disableOnMobiles": null,
			"text": "<i class='un-button-icon-chat'><\/i>Feedback",
			"style": {"background-color": null, "color": null},
			"class": "un-left"
		},
		"likes": null,
		"urls": {
			"feedback": {
				"post": "\/wp-admin\/admin-ajax.php?action=un_feedback_post",
				"get": "\/wp-admin\/admin-ajax.php?action=un_feedback_get",
				"like": "\/wp-admin\/admin-ajax.php?action=un_feedback_like",
				"get_id": "\/wp-admin\/admin-ajax.php?action=un_feedback_get_id",
				"all": "\/contact"
			},
			"comment": {"post": "\/wp-admin\/admin-ajax.php?action=un_comment_post"},
			"usernoise": "https:\/\/vietnam.unsw.adfa.edu.au\/wp-content\/plugins\/usernoise\/",
			"html2canvasproxy": "https:\/\/vietnam.unsw.adfa.edu.au\/wp-content\/plugins\/usernoise\/proxy.php"
		},
		"form": {
			"fields": {
				"email": {
					"type": "email",
					"label": "Email address",
					"placeholder": "you@example.com",
					"validators": ["email"]
				},
				"name": {
					"type": "text",
					"label": "Your name",
					"placeholder": "John Smith",
					"validators": ["required"]
				},
				"type": {
					"type": "dropdown",
					"label": "Feedback type",
					"default": null,
					"default_text": "Please select",
					"options": {
						idea: "Idea",
						praise: "Praise",
						problem: "Problem",
						question: "Question"
					},
					"validators": ["required"]
				}
			}
		},
		"comments": {"enabled": "1"},
		"screenshot": {"enable": true, "format": "png", "quality": 0.7}
	},
	"i18n": {
		"Leave a feedback": "Feedback",
		"Enter your feedback here": "Enter your feedback here",
		"Next": "Next",
		"Taking screenshot": "Taking screenshot",
		"Take a screenshot": "Take a screenshot",
		"screenshot.png": "screenshot.png",
		"Cancel": "Cancel",
		"Add some details": "Details",
		"Back": "Back",
		"Submit": "Submit",
		"Submitting": "Submitting",
		"Error sending feedback": "Error sending feedback",
		"Close": "Close",
		"OKText": "Your feedback was submitted successfully",
		"Done": "Done",
		"Please enter a valid email address": "Please enter a valid email address",
		"This field is required": "This field is required",
		"My feedback": "My feedback",
		"No feedback matching the criteria": "No feedback matching the criteria",
		"Comments:": "Comments:",
		"Leave a comment": "Leave a comment",
		"Like": "Like",
		"Your email": "Your email",
		"Your name": "Your name",
		"Comment text": "Comment text",
		"All feedback": "All feedback",
		"See what others a saying": "See what others a saying"
	}
};