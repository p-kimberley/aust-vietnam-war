<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$incidentID = $params['incidentID'];
	$noteTitle = urldecode($params['noteTitle']);
	$noteBody = urldecode($params['noteBody']);
	$noteAuthor = get_current_user_id();
	$noteAuthorData = get_userdata($noteAuthor);
	$noteAuthorProfile = bp_core_get_userlink($noteAuthor, $no_anchor = false, $just_link = true);
	$isEditor = current_user_can('editor');
	$isAdmin = current_user_can('administrator');
	$approvalStatus = -1;
	
	// Ensure the requester is logged in
	if ($noteAuthor != 0)
	{
		// Approve and publish the note straight away if the user is an admin or editor. Otherwise, set it to 'pending (-1)'
		if ($isEditor || $isAdmin)
			$approvalStatus = 1;
		
		$newNoteID = $wpdb->get_var($wpdb->prepare("CALL add_incident_note(%d, %s, %s, %d, %d)",
			$incidentID, $noteTitle, $noteBody, $noteAuthor, $approvalStatus));
		
		if ($newNoteID > 0)
		{
			// Construct an array of email addresses, containing all editor and admin users
			$recipients = [];
			$editors = get_users('role=editor');
			$admins = get_users('role=administrator');
			foreach( $editors as $editor ) {
				array_push($recipients, $editor->user_email);
			}
			foreach( $admins as $admin ) {
				array_push($recipients, $admin->user_email);
			}
			
			$serverProtocol = stripos($_SERVER['SERVER_PROTOCOL'], 'https') === true ? 'https://' : 'http://';
			$siteUrl = $serverProtocol . $_SERVER['HTTP_HOST'];
			$headers = "Content-Type: text/html; charset=ISO-8859-1\r\n";
			$body = 
				"<p>A new incident note was submitted by <a href='" . $noteAuthorProfile . "' target='_blank'>" . $noteAuthorData->first_name . " " . 
					$noteAuthorData->last_name . "</a> for incident " . $incidentID . " on the " .
				"<a href='https://vietnam.unsw.adfa.edu.au' target='_blank'>Australia's Vietnam War</a> website.</p>" . 
				"<p>The note is awaiting moderation. <a href='" . $siteUrl . "/battlemap/?incident-note=" . $newNoteID .
					"' target='_blank'>Open the note</a> to accept or reject it.</p>" . 
				"<hr>" . 
				"<p><strong>Title:</strong> " . $noteTitle . "<p>" . 
				"<p><strong>Submitted at:</strong> " . current_time('d/m/Y H:i') . "<p>" . 
				"<p><strong>Author email:</strong> " . $noteAuthorData->user_email . "</p>";
			
			// Post the record to the ES index
            $indexName = 'avw_incident_notes';
			$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
			$postData = array(
                'Incident_ID' => $incidentID,
                'Title' => $noteTitle,
                'Body' => $noteBody,
                'Created' => $currentDateTime,
                'Modified' => $currentDateTime,
                'Author' => array(
                    'ID' => $current_user->ID,
                    'Login' => $current_user->user_login,
                    'Name' => $current_user->display_name
                ),
                'Editor' => array(
					'ID' => $current_user->ID,
					'Login' => $current_user->user_login,
					'Name' => $current_user->display_name
				),
                'Approval_Status' => $approvalStatus,
				'Comments' => []
            );

			$result = apiIndexPut($indexName, 'incident_note', $newNoteID, $postData);
			
            if (!$result)
            {
                echo 'Failed to post to index. Post data: ' . json_encode($postData);
                http_response_code(500);
                exit(1);
            }
            else
            {
				wp_mail($recipients, "New incident note awaiting moderation", $body, $headers);
            }
		}
		
		echo $newNoteID;
	}
	else
	{
		echo 0;
	}
?>
