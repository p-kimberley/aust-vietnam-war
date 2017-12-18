<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
?>

<?php
	$userIDArray = explode(',', $_GET["userIDArray"]);
	$avatarSize = $_GET["avatarSize"];
	$userMeta = array();

	foreach($userIDArray as &$userID)
	{
		if ($userID != 0)
		{
			$authorProfile = bp_core_get_userlink($userID, $no_anchor = false, $just_link = true);
			$userNoteCount = intval($wpdb->get_var($wpdb->prepare("CALL get_user_note_count(%d)", $userID)));
			$vietnamVeteran = intval($wpdb->get_var($wpdb->prepare("CALL get_user_veteran_status(%d)", $userID)));
			
			$userData = array(
				'Profile_Page' => urlencode($authorProfile) . 'profile',
				'Avatar' => get_avatar($userID, $avatarSize),
				'User_Note_Count' => $userNoteCount,
				'Vietnam_Veteran' => $vietnamVeteran
			);
			
			array_push($userMeta, $userData);
		}
		else
		{
			array_push($userMeta, "");
		}
	}
	
	echo json_encode($userMeta);
?>
