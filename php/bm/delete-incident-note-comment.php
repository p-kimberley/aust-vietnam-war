<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$commentID = $params['commentID'];
	get_currentuserinfo();
	$userID = $current_user->ID;
	$authorID = 0;
	
	// Query the ID of the comment's author
	$result = $wpdb->get_row("SELECT Author FROM incident_note_comments WHERE ID=$commentID", OBJECT);
	
	if ($result)
	{
		$authorID = $result->Author;
	}
	
	// Only delete the note if the user is an editor, admin or the original comment author
	if (current_user_can('editor') || current_user_can('administrator') || $userID == $authorID)
	{
		$wpdb->query($wpdb->prepare("CALL delete_incident_note_comment(%d)", $commentID));
		echo 1;
	}
	else
	{
		echo 0;
	}
?>