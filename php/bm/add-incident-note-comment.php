<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$noteID = $params["noteID"];
	$comment = urldecode($params["comment"]);
	$noteAuthor = $params["noteAuthor"];
	$commentAuthor = get_current_user_id();
	$commentAuthorProfile = bp_core_get_userlink($commentAuthor, $no_anchor = false, $just_link = true);
	
	// Ensure the requester is logged in
	if ($commentAuthor != 0 && $noteID > 0 && $comment <> "")
	{
		$newCommentID = $wpdb->get_var($wpdb->query($wpdb->prepare("CALL add_incident_note_comment(%d, %s, %d)", $noteID, $comment, $commentAuthor)));
		echo 1;
		
		if ($newCommentID > 0)
		{
			$noteAuthorData = get_userdata($noteAuthor);
			$commentAuthorData = get_userdata($commentAuthor);
			
			// If the comment author is different to the note author, send a notification email
			// to the original note author informing them of the update.
			if ($noteAuthorData->ID != $commentAuthorData->ID)
			{
				$serverProtocol = stripos($_SERVER['SERVER_PROTOCOL'], 'https') === true ? 'https://' : 'http://';
				$siteUrl = $serverProtocol . $_SERVER['HTTP_HOST'];
				$headers = "Content-Type: text/html; charset=ISO-8859-1\r\n";
				$body = 
					"<p><a href='" . $commentAuthorProfile . "' target='_blank'>" . $commentAuthorData->first_name . " " . $commentAuthorData->last_name . "</a>" . 
						" commented on the note you submitted for an incident on the " .
					"<a href='https://vietnam.unsw.adfa.edu.au' target='_blank'>Australia's Vietnam War</a> website.</p>" . 
					"<hr>" . 
					"<p><strong>Comment:</strong><p>" . 
					"<p>" . $comment . "</p>" .
					"<hr>" . 
					"<p><a href='" . $siteUrl . "/battlemap/?incident-note=" . $noteID . "' target='_blank'>Open this note</a> to reply or view other comments.</p>";

				// Post the record to the ES index
				$indexName = 'avw_incident_notes';
				$currentDateTime = date('Y-m-d\TH:i:s', current_time('timestamp'));
				$postData = array(
					'script' => array(
						'inline' => 'ctx._source.Comments.add(comment)',
						'lang' => 'groovy',
						'params' => array(
							'comment' => array(
								'ID' => $newCommentID,
								'Comment' => $comment,
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
								)
							)
						)
					)
				);

				$result = apiIndexUpdate($indexName, 'incident_note', $noteID, $postData);

				if (!$result)
				{
					echo 'Failed to post to index. Post data: ' . json_encode($postData);
					http_response_code(500);
					exit(1);
				}
				else
				{
					wp_mail($noteAuthorData->user_email, "New comment on your incident note", $body, $headers);
					echo $newCommentID;
				}
			}
			
			echo $newCommentID;
		}
	}
	else
	{
		echo 0;
	}
?>
