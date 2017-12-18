<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
?>

<?php
	$params = json_decode(file_get_contents('php://input'), true);
	$noteID = $params['noteID'];
	$approvalStatus = $params['approvalStatus'];
	$userID = get_current_user_id();
	$isEditor = current_user_can('editor');
	$isAdmin = current_user_can('administrator');
	
	// Only update the note status if the user is an editor or admin
	if ($isEditor || $isAdmin)
	{
		$wpdb->query($wpdb->prepare("CALL update_incident_note_approval_status(%d, %d, %d)", $noteID, $userID, $approvalStatus));
		echo 1;
	}
	else
	{
		echo 0;
	}
?>
