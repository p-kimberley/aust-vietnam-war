<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>
<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$noteID = $params['noteID'];
	$noteTitle = urldecode($params['noteTitle']);
	$noteBody = urldecode($params['noteBody']);
	$userID = get_current_user_id();
	$isEditor = current_user_can('editor');
	$isAdmin = current_user_can('administrator');
	$approvalStatus = -1;
	
	$authorID = 0;
	
	// Query the ID of the comment's author
	$result = $wpdb->get_row("SELECT IncidentID, Author FROM incident_notes WHERE ID=$noteID", OBJECT);
	
	if ($result)
	{
		$incidentID = $result->IncidentID;
		$authorID = $result->Author;
		$noteAuthorData = get_userdata($authorID);
		$noteAuthorProfile = bp_core_get_userlink($authorID, $no_anchor = false, $just_link = true);
		
		// If this is an editor or admin, approve and publish the revised note straight away
		if ($isEditor || $isAdmin)
		{
			$approvalStatus = 1;
		}
		
		// Only update the note if the user is an editor, admin or the original note author
		if ($isEditor || $isAdmin || $userID == $authorID)
		{
			$wpdb->query($wpdb->prepare("CALL update_incident_note(%d, %s, %s, %d, %d)", $noteID, $noteTitle, $noteBody, $userID, $approvalStatus));
			
			// Update incident note ES record
			$indexName = 'avw_incident_notes';
			$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
			$postData = array(
				'doc' => array(
					'Title' => $noteTitle,
					'Body' => $noteBody,
					'Modified' => $currentDateTime,
					'Editor' => array(
						'ID' => $current_user->ID,
						'Login' => $current_user->user_login,
						'Name' => $current_user->display_name
					),
					'Approval_Status' => $approvalStatus
				)
			);
			
			if ($approvalStatus != -1)
			{
				$postData['doc']['Approval_Status_Changed'] = $currentDateTime;
				$postData['doc']['Approval_Status_Changed_By'] = $userID;
			}

			$result = apiIndexUpdate($indexName, 'incident_note', $noteID, $postData);
			echo $result;
			
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
				"<p>An incident note was updated by <a href='" . $noteAuthorProfile . "' target='_blank'>" . $noteAuthorData->first_name . " " . 
					$noteAuthorData->last_name . "</a> for incident " . $incidentID . " on the " .
				"<a href='https://vietnam.unsw.adfa.edu.au' target='_blank'>Australia's Vietnam War</a> website.</p>" . 
				"<p>The revised note is awaiting moderation. <a href='" . $siteUrl . "/battlemap/?incident-note=" . $noteID .
					"' target='_blank'>Open the note</a> to accept or reject it.</p>" . 
				"<hr>" . 
				"<p><strong>Title:</strong> " . $noteTitle . "<p>" . 
				"<p><strong>Submitted at:</strong> " . current_time('d/m/Y H:i') . "<p>" . 
				"<p><strong>Author email:</strong> " . $noteAuthorData->user_email . "</p>";

			wp_mail($recipients, "New incident note awaiting moderation", $body, $headers);
			
			echo 1;
		}
		else
		{
			echo 0;
		}
	}
	else
	{
		echo 0;
	}
?>
