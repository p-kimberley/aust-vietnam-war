<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$noteID = $params['noteID'];
	$userID = get_current_user_id();
	$authorID = 0;
	
	// Query the ID of the comment's author
	$result = $wpdb->get_row("SELECT Author FROM incident_notes WHERE ID=$noteID", OBJECT);
	
	if ($result)
	{
		$authorID = $result->Author;
	}
	
	// Only delete the note if the user is an editor, admin or the original comment author
	if (current_user_can('editor') || current_user_can('administrator') || $userID == $authorID)
	{
		$wpdb->query($wpdb->prepare("CALL delete_incident_note(%d)", $noteID));
		$result = apiIndexDelete('avw_incident_notes', 'incident_note', $noteID);
		echo $result;
	}
	else
	{
		echo 0;
	}
?>
